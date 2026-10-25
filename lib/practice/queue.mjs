// The queue rule shared by `clerk queue` and the desk: pure (clerk#204).
import { refersTo } from "./claim.mjs";

/** issues: REST issue objects plus `repo`; prs: open PR objects plus `repo`; lanes: lanesFrom(groups); holds: the work_hold labels;
 *  taken: {label: why} for positions that mean someone has it (the claim and in-review labels). Returns ordered queued/held rows. */
export function classify(issues, prs, LANES, holds, taken = {}) {
  const rows = issues.map((i) => {
    const labels = i.labels.map((l) => (typeof l === "string" ? l : l.name));
    const ref = `${i.repo}#${i.number}`;
    const pr = prs.find((p) => refersTo(i.repo, i.number, p));
    const held = [
      ...(i.assignee || i.assignees?.length ? [`assigned ${(i.assignees ?? [i.assignee]).map((a) => a.login).join(",")}`] : []),
      ...labels.filter((l) => holds.includes(l)),
      ...labels.filter((l) => taken[l]).map((l) => taken[l]),
      ...(pr ? [`open PR ${pr.repo}#${pr.number}`] : []),
    ];
    const priority = labels.map((l) => l.match(/^priority:\s*(P\d)$/)?.[1]).find(Boolean) ?? null;
    return { ref, title: i.title, url: i.html_url, created: i.created_at.slice(0, 10), priority,
      lanes: Object.keys(LANES).filter((l) => labels.includes(l)).map((l) => LANES[l]), held };
  });
  rows.sort((a, b) => (a.priority ?? "P9").localeCompare(b.priority ?? "P9") || a.created.localeCompare(b.created));
  return { queued: rows.filter((r) => !r.held.length), held: rows.filter((r) => r.held.length) };
}
