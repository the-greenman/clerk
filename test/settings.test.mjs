// A second programme: nothing SemanticOps-specific may leak through the settings plumbing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsFrom, issueRef } from '../lib/adapters/settings.mjs';
import { authorise } from '../lib/practice/roles.mjs';

const other = [{ record: { fieldValues: { programme_title: 'Acme programme', github_owner: 'acme', governed_repos: ['widgets', 'gadgets'],
  report_issue: 'widgets#7', digest_issue: 'widgets#9', board_project: 2, board_story_repo: 'widgets', owner_actor: 'human:ada' } } }];

test('settingsFrom maps the record to camelCase plus repos', () => {
  const s = settingsFrom(other);
  assert.deepEqual([s.title, s.githubOwner, s.repos, s.boardProject, s.boardStoryRepo, s.ownerActor], ['Acme programme', 'acme', ['widgets', 'gadgets'], 2, 'widgets', 'human:ada']);
  assert.equal(issueRef(s.reportIssue, s.githubOwner).path, 'acme/widgets/issues/7');
  assert.equal(issueRef(s.digestIssue, s.githubOwner).number, 9);
});
test('exactly one settings record is required', () => {
  assert.throws(() => settingsFrom([]), /exactly one .* found 0/);
  assert.throws(() => settingsFrom([...other, ...other]), /found 2/);
  assert.throws(() => issueRef('nonsense', 'acme'), /not <repo>#<n>/);
});
test('the owner role is held by the settings owner_actor, not a built-in actor', () => {
  const act = (id) => JSON.stringify({ kind: 'human', id });
  assert.ok(authorise('owner', act('human:ada'), settingsFrom(other).ownerActor));
  assert.throws(() => authorise('owner', act('human:the-greenman'), 'human:ada'), /held by human:ada/);
});
