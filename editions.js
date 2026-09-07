function renderWeeklyEditions(editions) {
  const archive=document.querySelector('#editionArchive'), content=document.querySelector('#editionContent');
  if(!archive || !content)return;
  archive.replaceChildren();content.replaceChildren();
  const text=(tag,value,parent)=>{const el=document.createElement(tag);el.textContent=value;parent.appendChild(el);return el;};
  if(!Array.isArray(editions) || !editions.length){
    text('p',Array.isArray(editions)?'The first edition arrives after a completed scoring week and commissioner review. Nobody has earned this week’s roast yet.':'The weekly archive is temporarily unavailable.',content);return;
  }
  const label=text('label','Read an edition ',archive);const select=document.createElement('select');
  select.className='commissioner-input';select.setAttribute('aria-label','Weekly edition archive');label.appendChild(select);
  for(const edition of editions){const option=text('option','Week '+edition.week+' · revision '+edition.revision,select);option.value=edition.id;}
  const show=()=>{
    const edition=editions.find(e=>e.id===select.value)||editions[0];content.replaceChildren();
    text('h3','Week '+edition.week+' · The Weekly Shaming',content);
    text('p','Published '+new Date(edition.published_at).toLocaleDateString()+'. Scores below are from this edition’s saved ESPN snapshot. Commentary is league satire.',content);
    if(edition.source_changed)text('p','ESPN results or team names have changed, or the source is unavailable. This historical edition awaits a reviewed revision.',content).className='edition-correction';
    const details=document.createElement('details');content.appendChild(details);text('summary','Read all '+edition.facts.length+' team reports',details);
    const grid=document.createElement('div');grid.className='edition-grid';details.appendChild(grid);
    for(const f of [...edition.facts].sort((a,b)=>a.weekly_rank-b.weekly_rank||Number(a.team_id)-Number(b.team_id))){
      const card=document.createElement('article');card.className='edition-team';grid.appendChild(card);
      text('h4',f.team_name,card);text('p',Number(f.score).toFixed(2)+' points · weekly scoring rank '+f.weekly_rank,card).className='edition-facts';
      text('p',edition.entries.find(e=>e.team_id===f.team_id)?.prose||'Commentary unavailable.',card);
    }
  };
  select.addEventListener('change',show);show();
}

function commissionerEditionMarkup(data) {
  const esc=escapeMemberText;const weeks=data.edition_weeks||[], drafts=(data.editions||[]).filter(e=>e.status==='DRAFT');
  let html='<article class="commissioner-persistent-item"><h3>The Weekly Shaming · editorial desk</h3><p>Drafts use saved ESPN results and local writing rules. No paid AI calls. Review the jokes before publishing; scores and ranks are fixed.</p>';
  if(weeks.length)html+='<label>Completed week <select id="editionWeek" class="commissioner-input">'+[...weeks].sort((a,b)=>b-a).map(w=>'<option value="'+Number(w)+'">Week '+Number(w)+'</option>').join('')+'</select></label><button class="commissioner-action" data-create-edition>Create or reopen draft</button>';
  else html+='<p>A completed ESPN scoring week is required before a draft can be created.</p>';
  for(const e of drafts){
    html+='<details class="edition-draft"><summary>Review Week '+Number(e.week)+' · revision '+Number(e.revision)+'</summary><p>Keep numeric stats in the verified fact lines. Save draft keeps it private; Publish makes the text visible to the league.</p>';
    for(const f of e.facts){
      const prose=e.entries.find(x=>x.team_id===f.team_id)?.prose||'';
      html+='<label class="edition-edit-label">'+esc(f.team_name)+' · '+Number(f.score).toFixed(2)+' points · rank '+Number(f.weekly_rank)+
        '<textarea class="commissioner-input" rows="4" maxlength="2000" data-edition="'+esc(e.id)+'" data-edition-team="'+esc(f.team_id)+'"'+(f.team_id==='3'?' readonly':'')+'>'+esc(prose)+'</textarea></label>';
    }
    html+='<div class="commissioner-actions"><button class="commissioner-action" data-save-edition="'+esc(e.id)+'">Save private draft</button><button class="commissioner-action primary" data-publish-edition="'+esc(e.id)+'">Publish to league</button></div></details>';
  }
  return html+'</article>';
}
