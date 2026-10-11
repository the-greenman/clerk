// Two chartered groups as `srs record list` would return them, read through the same pure reader the CLI uses.
// "WG Third-party ready" has the real programme's values; "WG Fixture" differs in every one.
import { groupsFrom } from '../lib/practice/groups.mjs';

const role = (id, title, charter) => ({ instanceId: id, record: { fieldValues: { title, ...charter } } });
const agent = (id, actor, seat) => ({ instanceId: id, record: { fieldValues: { title: actor, brief: 'b', actor_id: actor, seat } } });
const auth = (a, r) => ({ sourceId: a, targetId: r });

export const TPR = { steward: '7f34b620', builder: 'dd4177ef', reviewer: '6e255308', analyst: 'd10fa745' };
export const FX = { steward: 'fx-st', builder: 'fx-bu', reviewer: 'fx-re', scribe: 'fx-sc' };

export const roles = [
  role('834b61fd', 'WG Third-party ready', { group_label: 'wg:third-party-ready', quorum_min_members: 2, quorum_seats: ['steward', 'builder', 'reviewer'], quorum_required_seat: 'reviewer',
    budget_per_cycle: 10, cycle_close_utc: '11:30', max_unacked_reports: 2, governed_repos: ['srs-rust', 'srs', 'srs-vscode', 'srs-web'] }),
  role('fx-role', 'WG Fixture', { group_label: 'wg:fixture', quorum_min_members: 3, quorum_seats: ['steward', 'builder', 'reviewer', 'scribe'], quorum_required_seat: 'steward',
    budget_per_cycle: 4, cycle_close_utc: '16:00', max_unacked_reports: 3, governed_repos: ['fixture'] }),
  role('owner-role', 'Owner', {}), // no group_label: not a group
];
export const agents = [
  agent(TPR.steward, 'agent:tpr-steward', 'steward'), agent(TPR.builder, 'agent:tpr-builder', 'builder'), agent(TPR.reviewer, 'agent:tpr-reviewer', 'reviewer'), agent(TPR.analyst, 'agent:tpr-analyst', 'analyst'),
  agent(FX.steward, 'agent:fx-steward', 'steward'), agent(FX.builder, 'agent:fx-builder', 'builder'), agent(FX.reviewer, 'agent:fx-reviewer', 'reviewer'), agent(FX.scribe, 'agent:fx-scribe', 'scribe'),
];
export const authorisedBy = [...Object.values(TPR).map((a) => auth(a, '834b61fd')), ...Object.values(FX).map((a) => auth(a, 'fx-role'))];
export const containers = [{ containerId: 'c-tpr', title: 'WG Third-party ready' }, { containerId: 'c-fx', title: 'WG Fixture' }, { containerId: 'c-owner', title: 'SemanticOps decision log' }];

export const groups = groupsFrom(roles, agents, authorisedBy, containers);
export const [tprGroup, fxGroup] = groups;
