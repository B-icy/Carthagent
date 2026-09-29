import { mkdirSync, readFileSync, writeFileSync, renameSync, rmdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
function save(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value,null,2), { mode: 0o600 });
  const fd = openSync(temp,'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp,path);
  const dir = openSync(dirname(path),'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
function locked(path, fn) {
  const lock = path + '.lock';
  try { mkdirSync(lock); } catch { throw Error('Campaign busy or interrupted lock: inspect before retry'); }
  try { return fn(); } finally { rmdirSync(lock); }
}
export function initializeCampaign(path, { candidateLimit = 27, smokeLimit = .1, historicalCandidate = 1.675040682, historicalSmoke = .004935078 } = {}) {
  mkdirSync(dirname(path), {recursive:true});
  return locked(path, () => {
    // Exclusive creation: cannot discard old holds or spend by rerunning setup.
    const fd = openSync(path,'wx',0o600); closeSync(fd);
    const state = { version:1, limits:{candidate:candidateLimit,smoke:smokeLimit}, spent:{candidate:historicalCandidate,smoke:historicalSmoke}, historicalIncludesUnresolvedHolds:true, holds:{}, receipts:[] };
    save(path,state); return state;
  });
}
export function campaignAccount(path, category, run) {
  if (!['candidate','smoke'].includes(category)) throw Error('Invalid campaign category');
  return {
    reserve(amount) {
      if (!Number.isFinite(amount) || amount <= 0) throw Error('Invalid reservation');
      return locked(path, () => {
        const state = JSON.parse(readFileSync(path,'utf8'));
        const held = Object.values(state.holds).filter(h=>h.category===category).reduce((s,h)=>s+h.amount,0);
        if (state.spent[category]+held+amount>state.limits[category]+1e-12) throw Error('Campaign budget exhausted');
        const id=randomUUID(); state.holds[id]={category,run,amount,at:new Date().toISOString()}; save(path,state); return id;
      });
    },
    reconcile(id,cost) {
      return locked(path, () => {
        const state=JSON.parse(readFileSync(path,'utf8')), hold=state.holds[id];
        if (!hold || hold.category!==category || hold.run!==run || !Number.isFinite(cost) || cost<0 || cost>hold.amount) throw Error('Invalid campaign reconciliation');
        state.spent[category]+=cost; delete state.holds[id]; state.receipts.push({...hold,id,cost}); save(path,state);
      });
    },
  };
}
