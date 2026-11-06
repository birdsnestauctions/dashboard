// Bird's Nest Auctions payout math. Works in the browser (window.PayoutMath) and in Node (require).
//
// Rules (confirmed with Katie):
//   Estate sale:   client gets 50% of general sales up to the $10,000 mark, 65% above it (marginal).
//                  Gold & Silver sales count toward the $10,000 mark first.
//   Consignment:   client gets 50% of general sales, no tiers.
//   Gold & Silver: client gets 65% from the first dollar, both sale types.
//   Staff:         100%.   BNA house items: 0%.
//   Fees are deducted from the payee's share.
//   Full refund:   client paid on the original price if "client paid" is on, otherwise nothing.
//   Partial:       client paid on the reduced price unless "pay on original" is on.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PayoutMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIER_LIMIT = 10000;
  const HIGH_VALUE = 100;
  const GS_CATEGORY = 'Gold & Silver';

  const REASONS = {
    pack:        { g: 'ours',   name: 'Damaged in our handling or packing', paid: true },
    ship:        { g: 'ours',   name: 'Damaged in shipping', paid: true },
    catalog:     { g: 'ours',   name: 'Damage or flaw not in the description', paid: true },
    dup:         { g: 'ours',   name: 'Duplicate listing', paid: true },
    pickup:      { g: 'ours',   name: 'Missing or wrong item at pickup', paid: true },
    oursOther:   { g: 'ours',   name: 'Other Bird’s Nest error', paid: true, describe: true },
    removed:     { g: 'client', name: 'Client removed item after sale went live', paid: false },
    clientOther: { g: 'client', name: 'Other client error', paid: false, describe: true },
    broken:      { g: 'item',   name: 'Not working', paid: false },
    hidden:      { g: 'item',   name: 'Hidden damage we couldn’t see', paid: false },
    goodwill:    { g: 'other',  name: 'Buyer goodwill', paid: true },
    billing:     { g: 'other',  name: 'Billing correction (lot not affected)', paid: true },
    other:       { g: 'other',  name: 'Other reason', paid: true, describe: true },
  };
  const GROUPS = { ours: 'Bird’s Nest error', client: 'Client error', item: 'Item issue', other: 'Other' };

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const num = v => (v === '' || v == null ? null : Number(v));
  const truthy = v => v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'yes';
  const lotNum = s => { const m = String(s).match(/\d+/); return m ? Number(m[0]) : NaN; };

  // The default for "client paid?" on an adjustment, before anyone flips it.
  function defaultClientPaid(adj) {
    if (adj.kind === 'partial') return false;               // pay on the reduced price
    const r = REASONS[adj.reason];
    return r ? r.paid : null;                                // null = not decided yet
  }
  function clientPaid(adj) {
    if (adj.clientPaid !== '' && adj.clientPaid != null) return truthy(adj.clientPaid);
    return defaultClientPaid(adj);
  }
  function adjAmount(adj) {
    const o = num(adj.origPrice) || 0, n = num(adj.newPrice) || 0;
    return r2(o - n);
  }

  // Which payee a lot belongs to.
  function payeeKeyFor(sale, lot) {
    if (lot.payeeOverride) return String(lot.payeeOverride).trim();
    if (sale.type !== 'consignment') return 'CLIENT';
    const email = String(lot.consignorEmail || '').trim().toLowerCase();
    if (email) return email;
    const init = String(lot.initials || '').trim().toUpperCase();
    return init || 'UNASSIGNED';
  }

  function isGS(lot) {
    if (lot.gsOverride === 'yes') return true;
    if (lot.gsOverride === 'no') return false;
    return lot.category === GS_CATEGORY;
  }

  // The price the payout is calculated on, plus the adjustment that set it.
  function effectiveLot(lot, adjByLot) {
    const adj = adjByLot[String(lot.lotNo)];
    const sold = String(lot.status).toUpperCase() === 'SOLD';
    const current = sold ? (num(lot.price) || 0) : 0;
    if (!adj) return { price: current, adj: null, counted: sold };
    if (adj.status !== 'classified') {
      // Not decided yet: estimate on what BidPath shows now, but block close-out.
      return { price: current, adj, counted: sold, pending: true };
    }
    const paid = clientPaid(adj);
    const orig = num(adj.origPrice) || 0, now = num(adj.newPrice) || 0;
    if (adj.kind === 'partial') return { price: paid ? orig : now, adj, counted: true };
    return { price: paid ? orig : 0, adj, counted: paid };
  }

  function rateFor(payee) {
    const r = payee && payee.rate;
    return r === 'staff' || r === 'house' ? r : 'client';
  }

  // Main entry. data = { sale, lots, fees, adjustments, payees }
  function compute(data) {
    const sale = data.sale || {};
    const lots = data.lots || [];
    const fees = data.fees || [];
    const adjs = (data.adjustments || []).filter(a => a.status !== 'void');
    const payeeRows = data.payees || [];

    const adjByLot = {};
    adjs.forEach(a => { adjByLot[String(a.lotNo)] = a; });

    const payees = {};
    const ensure = key => {
      if (!payees[key]) {
        const row = payeeRows.find(p => String(p.payeeKey) === key) || {};
        const isHouse = key === 'BNA';
        payees[key] = {
          key, row,
          name: key === 'CLIENT' ? (sale.clientName || row.name || 'Client') : (row.name || key),
          email: key === 'CLIENT' ? (sale.clientEmail || row.email || '') : (row.email || (key.includes('@') ? key : '')),
          rate: row.rate || (isHouse ? 'house' : 'client'),
          lots: [], general: 0, gs: 0, generalShare: 0, gsShare: 0, share: 0,
          fees: [], feeTotal: 0, adjustments: [], adjustmentEffect: 0, payout: 0,
          soldCount: 0,
        };
      }
      return payees[key];
    };
    if (sale.type !== 'consignment') ensure('CLIENT');
    payeeRows.forEach(p => p.payeeKey && ensure(String(p.payeeKey)));

    // Lots
    lots.forEach(lot => {
      const key = payeeKeyFor(sale, lot);
      const p = ensure(key);
      const eff = effectiveLot(lot, adjByLot);
      const gs = isGS(lot);
      const line = { lot, price: r2(eff.price), gs, adj: eff.adj, pending: !!eff.pending, counted: eff.counted };
      p.lots.push(line);
      if (eff.counted) p.soldCount++;
      if (gs) p.gs += eff.price; else p.general += eff.price;
      if (eff.adj) p.adjustments.push(eff.adj);
    });

    // Shares
    Object.values(payees).forEach(p => {
      const rate = rateFor(p);
      p.rate = rate;
      p.general = r2(p.general); p.gs = r2(p.gs);
      if (rate === 'house') { p.generalShare = 0; p.gsShare = 0; }
      else if (rate === 'staff') { p.generalShare = p.general; p.gsShare = p.gs; }
      else {
        p.gsShare = r2(p.gs * 0.65);
        if (sale.type === 'consignment') p.generalShare = r2(p.general * 0.5);
        else {
          // Gold & Silver counts toward the $10,000 threshold but is always paid at 65% on its own line.
          const room = Math.max(0, TIER_LIMIT - p.gs);
          const low = Math.min(p.general, room), high = Math.max(0, p.general - room);
          p.generalShare = r2(low * 0.5 + high * 0.65);
          p.tierLow = r2(low); p.tierHigh = r2(high);
        }
      }
      p.share = r2(p.generalShare + p.gsShare);
      // What this payee would have earned with no adjustments, to show the effect on the internal view.
      let off = 0;
      p.lots.forEach(l => {
        if (l.adj && !l.pending) off += (num(l.adj.origPrice) || 0) - l.price;
      });
      p.adjustedOff = r2(off);   // sale-price dollars taken off this payee's lots by refunds
    });

    // Fees
    fees.forEach(f => {
      const key = f.payeeKey ? String(f.payeeKey) : (sale.type === 'consignment' ? 'UNASSIGNED' : 'CLIENT');
      const p = ensure(key);
      p.fees.push(f);
      p.feeTotal = r2(p.feeTotal + (num(f.amount) || 0));
    });

    Object.values(payees).forEach(p => {
      p.payout = r2(p.share - p.feeTotal);
      if (p.rate === 'house') p.payout = 0;
    });

    const list = Object.values(payees)
      .filter(p => p.lots.length || p.fees.length || p.key === 'CLIENT' || p.row.payeeKey)
      .sort((a, b) => (a.key === 'BNA') - (b.key === 'BNA') || a.name.localeCompare(b.name));

    const flags = buildFlags(sale, lots, list, adjs);
    const soldTotal = r2(list.reduce((s, p) => s + p.general + p.gs, 0));
    const payoutTotal = r2(list.reduce((s, p) => s + Math.max(0, p.payout), 0));
    const checks = list.filter(p => p.rate !== 'house' && p.payout > 0).length;
    return { payees: list, flags, soldTotal, payoutTotal, checks, openCount: flags.filter(f => f.blocking).length };
  }

  // "Sterling" or "925" anywhere counts (even in a mixed silverplate lot), except the coffee brand.
  // Karat marks count unless the item is plated or filled.
  const STERLING = /\bsterling\b(?!\s+(mocha|coffee))|\b925\b/i;
  const KARAT = /\b(10|14|18|22|24)\s?(k|kt|karat|carat)\b/i;
  const PLATED = /plated|gold[- ]filled|\bgf\b/i;
  const METAL = { test: s => STERLING.test(s) || (KARAT.test(s) && !PLATED.test(s)) };
  const NOT_METAL = { test: () => false };

  function buildFlags(sale, lots, payees, adjs) {
    const flags = [];
    adjs.filter(a => a.status !== 'classified').forEach(a => flags.push({
      kind: 'refund', blocking: true, lotNo: a.lotNo,
      text: `Lot ${a.lotNo}: ${a.kind === 'partial' ? 'price lowered' : 'refunded in full'}, needs a reason`,
    }));
    adjs.filter(a => a.status === 'classified' && adjAmount(a) >= HIGH_VALUE && !truthy(a.highValueOk)).forEach(a => flags.push({
      kind: 'highValue', blocking: true, lotNo: a.lotNo,
      text: `Lot ${a.lotNo}: ${money(adjAmount(a))} refund, confirm who gets paid`,
    }));
    if (sale.type === 'consignment') {
      const un = payees.find(p => p.key === 'UNASSIGNED' && p.lots.some(l => l.counted));
      if (un) flags.push({ kind: 'unassigned', blocking: true, text: `${un.lots.length} lot${un.lots.length === 1 ? '' : 's'} with no consignor` });
    }
    // House lots sitting inside a client's run of lot numbers.
    const byNum = lots.map(l => ({ l, n: lotNum(l.lotNo), key: payeeKeyFor(sale, l) })).filter(x => !isNaN(x.n)).sort((a, b) => a.n - b.n);
    byNum.forEach((x, i) => {
      if (x.key !== 'BNA' || x.l.payeeOverride) return;
      const prev = byNum[i - 1], next = byNum[i + 1];
      if (prev && next && prev.key === next.key && prev.key !== 'BNA' && next.n - prev.n <= 3) {
        flags.push({ kind: 'houseInRun', blocking: true, lotNo: x.l.lotNo, payee: prev.key,
          text: `Lot ${x.l.lotNo} is tagged BNA but sits inside ${prev.key}’s run of lots` });
      }
    });
    // Possible gold or sterling filed elsewhere.
    lots.forEach(l => {
      if (l.gsOverride || l.category === GS_CATEGORY) return;
      if (String(l.status).toUpperCase() !== 'SOLD') return;
      if (METAL.test(l.name || '') && !NOT_METAL.test(l.name || '')) {
        flags.push({ kind: 'metal', blocking: true, lotNo: l.lotNo,
          text: `Lot ${l.lotNo} mentions gold or sterling but is filed under ${l.category || 'no category'}` });
      }
    });
    return flags;
  }

  function money(n) {
    const v = Number(n) || 0;
    return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function dueDates(closeDate) {
    const c = new Date(closeDate);
    if (isNaN(c)) return null;
    const day = 86400000;
    return { target: new Date(c.getTime() + 21 * day), contract: new Date(c.getTime() + 30 * day) };
  }

  // "Refund lot 1017 $100. ..." -> { lotNo: '1017', amount: 100 }
  function parseRefundNotes(text) {
    const out = [];
    String(text || '').split(/\n+/).forEach(line => {
      const m = line.match(/refund\s+lot\s*#?\s*([A-Za-z0-9-]+)\s*\$?\s*([\d,]+(?:\.\d+)?)?/i);
      if (m) out.push({ lotNo: m[1], amount: m[2] ? Number(m[2].replace(/,/g, '')) : null, note: line.trim() });
    });
    return out;
  }

  // Suggest a reason from the words in a refund note.
  function suggestReason(note) {
    const t = String(note || '').toLowerCase();
    if (/duplicate/.test(t)) return 'dup';
    if (/ship|transit|arrived/.test(t)) return 'ship';
    if (/pack|wrap/.test(t)) return 'pack';
    if (/missing|wrong item|not found|couldn.t find|pickup/.test(t)) return 'pickup';
    if (/client (took|removed|kept)|removed .*after/.test(t)) return 'removed';
    if (/not working|doesn.t work|does not work|won.t turn|broken/.test(t)) return 'broken';
    if (/hidden|couldn.t see|inside/.test(t)) return 'hidden';
    if (/goodwill|changed (their|his|her) mind/.test(t)) return 'goodwill';
    if (/description|not disclosed|actually|mismarked|wrong size|karat|carat|\b\d+k\b/.test(t)) return 'catalog';
    return '';
  }

  return { compute, REASONS, GROUPS, HIGH_VALUE, defaultClientPaid, clientPaid, adjAmount, payeeKeyFor, isGS,
    money, dueDates, parseRefundNotes, suggestReason, r2, truthy };
});
