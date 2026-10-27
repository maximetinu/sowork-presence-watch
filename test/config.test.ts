import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_INTERVAL_SECONDS,
  readToolConfig,
  resolveConfig,
  soworkCliConfigPath,
  toolConfigPath,
  writeToolConfig,
} from '../src/config.ts';

const noSaved = () => ({});

test('the --api-key flag wins over the env var and the saved CLI key', () => {
  const result = resolveConfig(['--api-key', 'flag'], { SOWORK_API_KEY: 'env' }, () => ({ apiKey: 'saved' }));
  assert.equal(result.kind === 'config' && result.config.apiKey, 'flag');
});

test('SOWORK_API_KEY wins over the saved CLI key', () => {
  const result = resolveConfig([], { SOWORK_API_KEY: 'env' }, () => ({ apiKey: 'saved' }));
  assert.equal(result.kind === 'config' && result.config.apiKey, 'env');
});

test('the saved CLI key and base URL are the fallback', () => {
  const result = resolveConfig([], {}, () => ({ apiKey: 'saved', baseUrl: 'https://example.test' }));
  assert.equal(result.kind, 'config');
  assert.equal(result.kind === 'config' && result.config.apiKey, 'saved');
  assert.equal(result.kind === 'config' && result.config.baseUrl, 'https://example.test');
});

test('no key anywhere is an error that says how to get one', () => {
  const result = resolveConfig([], {}, noSaved);
  assert.equal(result.kind, 'error');
  assert.match(result.kind === 'error' ? result.message : '', /sowork login/);
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

test('the saved alert command round-trips through the settings file, and saving none clears it', () => {
  const env = { SOWORK_PRESENCE_WATCH_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'spw-')) };
  assert.deepEqual(readToolConfig(env), { alertCommand: undefined });
  assert.equal(writeToolConfig(env, { alertCommand: 'monica "$SOWORK_PRESENCE_WATCH_MESSAGE"' }), undefined);
  assert.equal(toolConfigPath(env), path.join(env.SOWORK_PRESENCE_WATCH_CONFIG_DIR, 'config.json'));
  assert.deepEqual(readToolConfig(env), { alertCommand: 'monica "$SOWORK_PRESENCE_WATCH_MESSAGE"' });
  assert.equal(writeToolConfig(env, { alertCommand: undefined }), undefined);
  assert.deepEqual(readToolConfig(env), { alertCommand: undefined });
});
