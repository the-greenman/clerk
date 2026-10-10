// Discussion on proposals: com.semanticops.comments comments joined by comments-on relations. Pure; no I/O.
// Humans and agents comment the same way; the author is the record's createdBy (the session actor).
import { fv } from './agenda.mjs';

export const COMMENT_TYPE = 'com.semanticops.comments/comment';
export const COMMENTS_ON = 'com.semanticops.comments/comments-on';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// -> [{ comment, depth, n }] in reading order: top-level comments by time, each followed by its replies (nested by depth), n = 1.. for [reply to].
export function thread(targetId, relations, comments) {
  const byId = new Map(comments.map((c) => [c.instanceId, c]));
  const kids = (id) => relations.filter((x) => x.targetId === id && byId.has(x.sourceId)).map((x) => byId.get(x.sourceId))
    .sort((a, b) => String(a.record.createdAt).localeCompare(String(b.record.createdAt)));
  const out = [];
  const walk = (id, depth) => kids(id).forEach((c) => { out.push({ comment: c, depth, n: out.length + 1 }); walk(c.instanceId, depth + 1); });
  walk(targetId, 0);
  return out;
}

const author = (c) => c.record.createdBy?.name ?? c.record.createdBy?.id ?? 'unattributed';
const first = (c) => String(fv(c).comment_text ?? '').split('\n')[0].trim().slice(0, 140);
const row = (t) => `${'  '.repeat(t.depth)}${author(t.comment)} ${String(t.comment.record.createdAt).slice(0, 10)}: ${first(t.comment)}`;

// The item screen: a count and the latest 3 (replies indented once per level). Full thread for [v]iew discussion.
export function discussionLines(th, all = false) {
  const shown = all ? th : th.slice(-3);
  return [`  Discussion: ${th.length} comment${th.length === 1 ? '' : 's'}${!all && th.length > 3 ? ' (latest 3; [v] for all)' : ''}`,
    ...shown.map((t) => '    ' + (all ? `${t.n}. ` : '') + row(t))];
}
export const fullDiscussion = (th) => th.length ? th.flatMap((t) => [`    ${t.n}. ${row(t)}`, ...String(fv(t.comment).comment_text ?? '').split('\n').slice(1).map((l) => '    ' + '  '.repeat(t.depth) + '   ' + l)]) : ['    (no comments)'];

// A citation as a sourceRef (provenance pointer, never a relation). cite: 'transcript' | source-document id | URL.
// role: evidence | extracted-from | quoted-from | inspired-by | attaches. note carries a passage locator (the schema has no locator field).
export function buildSourceRef(cite, role, { transcriptId, note } = {}) {
  if (!cite) return null;
  const withNote = (r) => (note ? { ...r, note } : r);
  if (cite === 'transcript') {
    if (!transcriptId) throw new Error('cannot cite "transcript": this session has no transcript (use --transcript)');
    return withNote({ sourceType: 'repository-document', sourceId: transcriptId, sourceRole: role ?? 'quoted-from' });
  }
  if (UUID.test(cite)) return withNote({ sourceType: 'repository-document', sourceId: cite, sourceRole: role ?? 'evidence' });
  if (/^https?:\/\//.test(cite)) return withNote({ sourceType: 'external-document', sourceId: cite, sourceRole: role ?? 'evidence' });
  throw new Error(`cite must be "transcript", a source-document id or a URL, not "${cite}"`);
}
