// Pure rules shared by the browser and trusted submission API. IDs, not labels.
export function ticketConflict(legs: any[]) {
  const normalized = legs.map(leg => {
    const id = leg.odd_id || leg.providerOddId || '';
    const [stat, entity, period, type, side] = id.split('-');
    const raw = leg.line_value ?? leg.line;
    return { id, event: leg.event_id || leg.providerEventId || leg.eventId,
      stat, entity, period, type, side,
      line: raw == null || raw === '' ? null : Number(raw) };
  });
  for (let i=0; i<normalized.length; i++) for (let j=0; j<i; j++) {
    const a=normalized[i], b=normalized[j];
    if (!a.id || !b.id || a.event!==b.event) continue;
    if (a.id===b.id) return 'This selection is already on your ticket.';
    if (a.stat!==b.stat || a.period!==b.period) continue;
    if (a.type==='ml' && b.type==='ml' && a.side!==b.side)
      return 'Both teams cannot win the same game. Choose one moneyline.';
    if (a.entity===b.entity && a.type==='yn' && b.type==='yn' && a.side!==b.side)
      return 'Yes and No for the same outcome cannot both win.';
    if (a.entity===b.entity && a.type==='ou' && b.type==='ou' && a.side!==b.side) {
      const over=a.side==='over'?a:b, under=a.side==='under'?a:b;
      if (Number.isFinite(over.line) && Number.isFinite(under.line) && over.line>=under.line)
        return 'These Over and Under selections cannot both win. Remove one.';
    }
    // Express team moneylines/spreads as strict bounds on the home margin.
    if (a.stat==='points' && ['ml','sp'].includes(a.type) && ['ml','sp'].includes(b.type)
        && ['home','away'].includes(a.side) && ['home','away'].includes(b.side) && a.side!==b.side) {
      const home=a.side==='home'?a:b, away=a.side==='away'?a:b;
      const h=home.type==='ml'?0:home.line, v=away.type==='ml'?0:away.line;
      if (Number.isFinite(h) && Number.isFinite(v) && -h>=v)
        return 'These team selections require conflicting game results. Remove one.';
    }
  }
  return null;
}

