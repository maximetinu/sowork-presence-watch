import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_INTERVAL_SECONDS,
  profileNameProblem,
  readToolConfig,
  renameProfile,
  resolveConfig,
  soworkCliConfigPath,
  toolConfigPath,
  updateToolConfig,
} from '../src/config.ts';

const noSaved = () => ({});

test('the --api-key flag wins over SOWORK_API_KEY, and the source is kept', () => {
  const result = resolveConfig(['--api-key', 'flag'], { SOWORK_API_KEY: 'env' }, noSaved);
  assert.deepEqual(result.kind === 'config' && result.config.apiKey, { key: 'flag', source: 'flag' });
  const fromEnv = resolveConfig([], { SOWORK_API_KEY: 'env' }, noSaved);
  assert.deepEqual(fromEnv.kind === 'config' && fromEnv.config.apiKey, { key: 'env', source: 'env' });
});

test('without a flag or env key there is no key: the profile picker runs instead', () => {
  const result = resolveConfig([], {}, () => ({ apiKey: 'saved-by-sowork-login' }));
  assert.equal(result.kind, 'config');
  assert.equal(result.kind === 'config' && result.config.apiKey, undefined);
});

test('--profile is read, and the saved CLI base URL is the fallback', () => {
  const result = resolveConfig(['--profile', 'work'], {}, () => ({ baseUrl: 'https://example.test' }));
  assert.equal(result.kind === 'config' && result.config.profile, 'work');
  assert.equal(result.kind === 'config' && result.config.baseUrl, 'https://example.test');
});

test('interval defaults, reads the env var, and rejects values under the minimum', () => {
  const byDefault = resolveConfig([], { SOWORK_API_KEY: 'k' }, noSaved);
  assert.equal(byDefault.kind === 'config' && byDefault.config.intervalSeconds, DEFAULT_INTERVAL_SECONDS);

  const fromEnv = resolveConfig([], { SOWORK_API_KEY: 'k', SOWORK_PRESENCE_WATCH_INTERVAL: '45' }, noSaved);
  assert.equal(fromEnv.kind === 'config' && fromEnv.config.intervalSeconds, 45);

  assert.equal(resolveConfig(['--interval', '5'], { SOWORK_API_KEY: 'k' }, noSaved).kind, 'error');
  assert.equal(resolveConfig(['--interval', 'abc'], { SOWORK_API_KEY: 'k' }, noSaved).kind, 'error');
});

test('--watch repeats and --alert-command falls back to the env var', () => {
  const result = resolveConfig(
    ['--watch', 'Alex', '--watch', 'Bea'],
    { SOWORK_API_KEY: 'k', SOWORK_PRESENCE_WATCH_ALERT_COMMAND: 'say hi' },
    noSaved,
  );
  assert.deepEqual(result.kind === 'config' && result.config.watch, ['Alex', 'Bea']);
  assert.equal(result.kind === 'config' && result.config.alertCommand, 'say hi');
});

test('an unknown flag is an error', () => {
  assert.equal(resolveConfig(['--nope'], { SOWORK_API_KEY: 'k' }, noSaved).kind, 'error');
});

test('the CLI config path follows SOWORK_CONFIG_DIR, then XDG_CONFIG_HOME', () => {
  assert.equal(soworkCliConfigPath({ SOWORK_CONFIG_DIR: '/a', XDG_CONFIG_HOME: '/b' }), path.join('/a', 'config.json'));
  assert.equal(soworkCliConfigPath({ XDG_CONFIG_HOME: '/b' }), path.join('/b', 'sowork', 'config.json'));
});

test('the alert command comes from the flag, then the env var, then the saved setting', () => {
  const saved = () => ({ alertCommand: 'saved' });
  const flag = resolveConfig(['--alert-command', 'flag'], { SOWORK_API_KEY: 'k', SOWORK_PRESENCE_WATCH_ALERT_COMMAND: 'env' }, noSaved, saved);
  assert.deepEqual(flag.kind === 'config' && [flag.config.alertCommand, flag.config.alertCommandSource], ['flag', 'flag']);
  const env = resolveConfig([], { SOWORK_API_KEY: 'k', SOWORK_PRESENCE_WATCH_ALERT_COMMAND: 'env' }, noSaved, saved);
  assert.deepEqual(env.kind === 'config' && [env.config.alertCommand, env.config.alertCommandSource], ['env', 'env']);
  const fromFile = resolveConfig([], { SOWORK_API_KEY: 'k' }, noSaved, saved);
  assert.deepEqual(fromFile.kind === 'config' && [fromFile.config.alertCommand, fromFile.config.alertCommandSource], ['saved', 'saved']);
  const none = resolveConfig([], { SOWORK_API_KEY: 'k' }, noSaved);
  assert.deepEqual(none.kind === 'config' && [none.config.alertCommand, none.config.alertCommandSource], [undefined, 'default']);
});

const tempEnv = () => ({ SOWORK_PRESENCE_WATCH_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'spw-')) });

test('an empty settings file reads as no profiles', () => {
  const env = tempEnv();
  assert.equal(toolConfigPath(env), path.join(env.SOWORK_PRESENCE_WATCH_CONFIG_DIR, 'config.json'));
  assert.deepEqual(readToolConfig(env), { alertCommand: undefined, lastProfile: undefined, profiles: {} });
});

test('profiles, the last profile and the alert command round-trip through the settings file', () => {
  const env = tempEnv();
  assert.equal(
    updateToolConfig(env, (c) => {
      c.profiles.work = { apiKey: 'sw_1', userName: 'Sam', watched: ['u1'] };
      c.lastProfile = 'work';
    }),
    undefined,
  );
  assert.equal(
    updateToolConfig(env, (c) => {
      c.alertCommand = 'monica "$SOWORK_PRESENCE_WATCH_MESSAGE"';
    }),
    undefined,
  );
  assert.deepEqual(readToolConfig(env), {
    alertCommand: 'monica "$SOWORK_PRESENCE_WATCH_MESSAGE"',
    lastProfile: 'work',
    profiles: { work: { apiKey: 'sw_1', userName: 'Sam', watched: ['u1'] } },
  });
  updateToolConfig(env, (c) => {
    c.alertCommand = undefined;
    delete c.profiles.work;
  });
  assert.deepEqual(readToolConfig(env).profiles, {});
  assert.equal(readToolConfig(env).alertCommand, undefined);
});

test('profiles without a key or with a bad name are dropped when read', () => {
  const env = tempEnv();
  writeFileSync(
    toolConfigPath(env),
    JSON.stringify({ profiles: { ok: { apiKey: 'k' }, nokey: { watched: [] }, 'bad name': { apiKey: 'k' } } }),
  );
  assert.deepEqual(readToolConfig(env).profiles, { ok: { apiKey: 'k', userName: undefined, watched: [] } });
});

test('profileNameProblem rejects bad and taken names', () => {
  const config = { alertCommand: undefined, lastProfile: undefined, profiles: { work: { apiKey: 'k', userName: undefined, watched: [] } } };
  assert.equal(profileNameProblem('client-x', config), undefined);
  assert.match(profileNameProblem('work', config) ?? '', /already exists/);
  assert.match(profileNameProblem('has space', config) ?? '', /letters/);
  assert.match(profileNameProblem('__proto__', config) ?? '', /letters/);
  assert.match(profileNameProblem('', config) ?? '', /letters/);
});

test('renameProfile moves the profile and the last profile opened', () => {
  const work = { apiKey: 'k', userName: 'Alex', watched: ['u1'] };
  const config = { alertCommand: undefined, lastProfile: 'work', profiles: { work } };
  renameProfile(config, 'work', 'office');
  assert.deepEqual(config, { alertCommand: undefined, lastProfile: 'office', profiles: { office: work } });
  renameProfile(config, 'missing', 'other');
  assert.deepEqual(Object.keys(config.profiles), ['office']);
});
