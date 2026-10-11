/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS export is required by the independent verification runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createRequire} = require('node:module');
const appRequire = createRequire('/tmp/app/package.json');
const {createClient} = appRequire('@libsql/client');

exports.verify = async function verify({browser, baseUrl, evidenceDir}) {
  if(evidenceDir) await fs.mkdir(evidenceDir,{recursive:true});
  const db = createClient({url:process.env.TURSO_DATABASE_URL, authToken:process.env.TURSO_AUTH_TOKEN});
  const contexts = [], owned = [], checks = [];
  const passed = name => checks.push({name, passed:true});
  const snapshot = async workspace => {
    const tables = ['workspace','session','category','expense'];
    const result = {};
    for (const table of tables) {
      const sql = workspace ? `SELECT * FROM ${table} WHERE ${table==='workspace'?'id':'workspace_id'}=? ORDER BY id` : `SELECT * FROM ${table} ORDER BY id`;
      result[table] = (await db.execute({sql, args:workspace?[workspace]:[]})).rows.map(row=>Object.fromEntries(Object.entries(row)));
    }
    return result;
  };
  const counts = async () => {
    const result = {};
    for (const table of ['workspace','session','category','expense']) result[table] = Number((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
    return result;
  };
  const origin = new URL(baseUrl).origin;
  const send = (context, resource, method='GET', data, csrf, requestOrigin=origin) => context.request.fetch(baseUrl+'/api/'+resource, {
    method, headers:{Origin:requestOrigin,...(csrf?{'x-csrf-token':csrf}:{})}, ...(data!==undefined?{data}:{})
  });
  const newContext = async viewport => {
    const context = await browser.newContext({viewport:viewport||{width:1440,height:900},locale:'es-ES'});
    contexts.push(context); return context;
  };
  const track = async context => {
    const cookie = (await context.cookies()).find(c=>c.name==='gastos'||c.name==='__Host-gastos');
    assert(cookie, 'Session cookie exists');
    const hash = createHash('sha256').update(cookie.value).digest('hex');
    const rows = (await db.execute({sql:'SELECT workspace_id FROM session WHERE secret_hash=?',args:[hash]})).rows;
    assert.equal(rows.length,1); const workspace=String(rows[0].workspace_id); owned.push(workspace);
    assert(cookie.httpOnly); assert.equal(cookie.path,'/');
    if (origin.startsWith('https:')) {assert(cookie.secure); assert.equal(cookie.sameSite,'None'); assert.equal(cookie.name,'__Host-gastos');}
    return workspace;
  };
  let baseline;
  try {
    // Initialize schema via the real handler before taking the preserved-record snapshot.
    const warm = await newContext(); const initial = await send(warm,'session','POST'); assert.equal(initial.status(),201);
    await track(warm);
    const onboarding=await warm.newPage();
    await onboarding.goto(baseUrl);
    const onboardingDialog=onboarding.getByRole('dialog');
    await onboarding.getByRole('heading',{name:'Primero, elige tu moneda',exact:true}).waitFor();
    const assertOverlay = async page => {
      const geometry=await page.locator('[data-modal-overlay]').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,position:getComputedStyle(el).position}});
      assert.equal(geometry.position,'fixed'); assert(Math.abs(geometry.x)<1 && Math.abs(geometry.y)<1);
      assert(Math.abs(geometry.width-geometry.viewportWidth)<1 && Math.abs(geometry.height-geometry.viewportHeight)<1,JSON.stringify(geometry));
    };
    await assertOverlay(onboarding);
    if(evidenceDir)await onboarding.screenshot({path:path.join(evidenceDir,'currency-onboarding-desktop.png'),fullPage:false});
    await onboarding.keyboard.press('Escape'); await onboardingDialog.waitFor({state:'hidden'});
    assert.equal((await (await send(warm,'settings')).json()).currency,null);
    await onboarding.getByRole('button',{name:'Elegir moneda',exact:true}).last().click();
    await onboardingDialog.waitFor(); await onboarding.getByRole('button',{name:'Explorar primero',exact:true}).click();
    await onboardingDialog.waitFor({state:'hidden'});
    await onboarding.getByRole('button',{name:'Añadir gasto',exact:true}).first().click(); await onboardingDialog.waitFor();
    await onboarding.getByRole('button',{name:'Cerrar panel',exact:true}).click(); await onboardingDialog.waitFor({state:'hidden'});
    const unsetToken=(await (await send(warm,'session')).json()).csrf;
    const unsetCategory=(await (await send(warm,'categories')).json())[0].id;
    const unsetExpense={concept:'QA · Bloqueado sin moneda',amount:'1',date:'2026-10-11',category_id:unsetCategory,note:''};
    for(const [resource,method] of [['expenses','POST'],['expenses/nonexistent','PATCH'],['expenses/nonexistent','DELETE']]) {
      assert([404,409].includes((await send(warm,resource,method,method==='DELETE'?undefined:unsetExpense,unsetToken)).status()));
    }
    assert.equal((await (await send(warm,'expenses?month=2026-10')).json()).length,0);
    await onboarding.reload(); await onboardingDialog.waitFor();
    await onboarding.setViewportSize({width:320,height:740}); await assertOverlay(onboarding); await onboarding.waitForTimeout(220);
    if(evidenceDir)await onboarding.screenshot({path:path.join(evidenceDir,'currency-onboarding-320.png'),fullPage:false});
    await onboarding.getByRole('button',{name:'Explorar primero',exact:true}).click(); await onboardingDialog.waitFor({state:'hidden'});
    if(evidenceDir)await onboarding.screenshot({path:path.join(evidenceDir,'explore-empty-320.png'),fullPage:true});
    await onboarding.getByRole('button',{name:'Elegir moneda',exact:true}).last().click(); await onboardingDialog.waitFor();
    await onboarding.getByLabel('Moneda',{exact:true}).selectOption('EUR');
    await onboarding.getByRole('button',{name:'Continuar y añadir gasto',exact:true}).click();
    await onboarding.getByRole('heading',{name:'Añadir gasto',exact:true}).waitFor();
    await onboarding.getByRole('button',{name:'Cancelar',exact:true}).click();
    await onboardingDialog.waitFor({state:'hidden'}); await onboarding.reload();
    await onboarding.getByRole('heading',{name:'Tu registro',exact:true}).waitFor();
    assert.equal((await (await send(warm,'settings')).json()).currency,'EUR');
    assert.equal((await (await send(warm,'expenses?month=2026-10')).json()).length,0);
    passed('Onboarding dismisses by Escape, close and Explorar primero; empty dashboard restores choice, mutation requires currency, selection persists after reload');
    await onboarding.close();
    baseline = await snapshot(); const before = await counts();
    const simultaneous = await Promise.all(Array.from({length:3},()=>newContext()));
    const responses = await Promise.all(simultaneous.map(c=>send(c,'session','POST')));
    for (let i=0;i<responses.length;i++) {assert.equal(responses[i].status(),201); await track(simultaneous[i]);}
    const after = await counts();
    assert.equal(after.workspace,before.workspace+3); assert.equal(after.session,before.session+3); assert.equal(after.category,before.category+18); assert.equal(after.expense,before.expense);
    const sessions = await Promise.all(responses.map(r=>r.json()));
    assert.equal(new Set(sessions.map(s=>s.csrf)).size,3);
    passed('Concurrent anonymous initialization creates exactly one workspace, session and six categories per new client');
    const context = simultaneous[0], workspace=owned[1], token=sessions[0].csrf;
    const established = await snapshot(workspace), stableCounts = await counts();
    const repeated = await Promise.all(Array.from({length:5},()=>send(context,'session','POST')));
    for (const response of repeated) {assert.equal(response.status(),200); assert.equal((await response.json()).csrf,token); assert.equal(response.headers()['set-cookie'],undefined);}
    assert.deepEqual(await counts(),stableCounts); assert.deepEqual(await snapshot(workspace),established);
    passed('Concurrent repeated initialization reuses established cookie without duplicating workspace, categories or data');
    assert.equal((await send(context,'settings','PATCH',{currency:'EUR'},token)).status(),200);
    const categories = await (await send(context,'categories')).json(); assert.equal(categories.length,6);
    const expense={concept:'QA · Verificación de persistencia',amount:'12,34',date:'2026-10-11',category_id:categories[0].id,note:'QA · Registro temporal de prueba'};
    const beforeReject = await snapshot(workspace);
    for (const [resource,method,data] of [['expenses','POST',expense],['categories','POST',{name:'QA · Bloqueada'}],['settings','PATCH',{currency:'USD'}]]) {
      assert.equal((await send(context,resource,method,data,sessions[1].csrf)).status(),403);
      assert.equal((await send(context,resource,method,data,token,'https://unauthorized.example')).status(),403);
      assert.equal((await send(context,resource,method,data)).status(),403);
    }
    assert.deepEqual(await snapshot(workspace),beforeReject); assert.deepEqual(await counts(),stableCounts);
    passed('Foreign-session CSRF tokens, missing tokens and unauthorized origins reject mutations without persisted changes');
    for (const invalid of [{amount:'0'},{amount:'1.234'},{concept:' '},{date:'2026-02-30'},{category_id:categories[0].id+'invalid'}]) {
      assert.equal((await send(context,'expenses','POST',{...expense,...invalid},token)).status(),422);
    }
    assert.deepEqual(await snapshot(workspace),beforeReject);
    passed('Real expense handler rejects invalid concept, precision, amount, date and category without writes');
    const page=await context.newPage(); const browserErrors=[]; page.on('pageerror',e=>browserErrors.push(e.message));
    await page.goto(baseUrl); await page.getByRole('heading',{name:'Tu registro',exact:true}).waitFor();
    await page.getByLabel('Mes y año',{exact:true}).fill('2026-10');
    await page.locator('[aria-busy="true"]').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Añadir gasto',exact:true}).first().click();
    const dialog=page.getByRole('dialog'); await dialog.waitFor();
    await page.getByRole('button',{name:'Guardar gasto',exact:true}).click();
    await page.getByText('Escribe un concepto.',{exact:true}).waitFor();
    assert.equal(await page.locator('#concept').getAttribute('aria-invalid'),'true');
    await page.waitForFunction(()=>document.activeElement?.id==='concept');
    await page.getByLabel('Concepto',{exact:true}).fill(expense.concept);
    await page.getByLabel('Importe (EUR)',{exact:true}).fill(expense.amount);
    await page.getByLabel('Fecha',{exact:true}).fill(expense.date);
    assert.equal(await page.locator('#date-hint').textContent(),'11 de octubre de 2026');
    await page.locator('#category_id').selectOption(expense.category_id);
    await page.getByLabel('Nota (opcional)',{exact:true}).fill(expense.note);
    await page.getByRole('button',{name:'Guardar gasto',exact:true}).click();
    await dialog.waitFor({state:'hidden'}); await page.getByRole('button',{name:'Editar '+expense.concept,exact:true}).waitFor();
    await page.reload(); await page.getByRole('button',{name:'Editar '+expense.concept,exact:true}).waitFor();
    let records=await (await send(context,'expenses?month=2026-10')).json(); assert.equal(records.length,1); assert.equal(records[0].amount_minor,1234); assert.equal(records[0].date,expense.date);
    const eid=records[0].id;
    passed('Primary browser flow validates fields, saves expense and retains exact amount and local calendar date after reload');
    await page.getByRole('button',{name:'Editar '+expense.concept,exact:true}).click();
    await page.locator('#amount').fill('20.01'); await page.getByRole('button',{name:'Guardar cambios',exact:true}).click(); await dialog.waitFor({state:'hidden'});
    assert.equal((await (await send(context,`expenses/${eid}`)).json()).amount_minor,2001);
    await page.getByLabel('Buscar concepto',{exact:true}).fill('sin coincidencias QA'); await page.getByText('Sin resultados para estos filtros').waitFor();
    assert.equal((await (await send(context,'monthly?month=2026-10')).json()).total,2001);
    await page.getByRole('button',{name:'Limpiar filtros',exact:true}).first().click(); await page.getByRole('button',{name:'Editar '+expense.concept,exact:true}).waitFor();
    await page.locator('#category-filter').selectOption(categories[1].id); await page.getByText('Sin resultados para estos filtros').waitFor();
    await page.getByRole('button',{name:'Limpiar filtros',exact:true}).first().click();
    passed('Edit persists exact decimal amount; search and category filters preserve full monthly totals');
    await page.getByRole('button',{name:'Categorías',exact:true}).click();
    await page.getByRole('button',{name:'Nueva categoría',exact:true}).click();
    await page.getByRole('button',{name:'Guardar categoría',exact:true}).click();
    await page.getByText('Escribe un nombre.',{exact:true}).waitFor();
    await page.getByLabel('Nombre de la categoría',{exact:true}).fill('QA · Categoría temporal');
    await page.getByRole('button',{name:'Guardar categoría',exact:true}).click(); await dialog.waitFor({state:'hidden'});
    const categoryRow = name => page.getByText(name,{exact:true}).locator('..').locator('..');
    await categoryRow('QA · Categoría temporal').getByRole('button',{name:'Renombrar',exact:true}).click();
    await page.getByLabel('Nombre de la categoría',{exact:true}).fill('QA · Renombrada desde panel');
    await page.getByRole('button',{name:'Guardar categoría',exact:true}).click(); await dialog.waitFor({state:'hidden'});
    await categoryRow('QA · Renombrada desde panel').getByRole('button',{name:'Archivar',exact:true}).click();
    await categoryRow('QA · Renombrada desde panel').getByText('Archivada',{exact:true}).waitFor();
    await categoryRow('QA · Renombrada desde panel').getByRole('button',{name:'Restaurar',exact:true}).click();
    await categoryRow('QA · Renombrada desde panel').getByText('Activa',{exact:true}).waitFor();
    await page.reload(); await page.getByRole('button',{name:'Categorías',exact:true}).click();
    await page.getByText('QA · Renombrada desde panel',{exact:true}).waitFor();
    const createdCategories=await (await send(context,'categories')).json();
    const cid=createdCategories.find(c=>c.name==='QA · Renombrada desde panel').id;
    passed('Category panel validates empty names, creates, renames, archives and restores with persisted reload');
    await page.getByRole('button',{name:'Registro',exact:true}).click();
    await page.getByLabel('Mes y año',{exact:true}).fill('2026-10');
    await page.getByRole('button',{name:'Editar '+expense.concept,exact:true}).waitFor();
    assert.equal((await send(context,`categories/${cid}`,'PATCH',{name:'QA · Renombrada'},token)).status(),200);
    assert.equal((await send(context,'categories','POST',{name:'qa · renombrada'},token)).status(),409);
    assert.equal((await send(context,`categories/${expense.category_id}`,'PATCH',{archived:true},token)).status(),200);
    assert.equal((await (await send(context,`expenses/${eid}`)).json()).archived,1);
    assert.equal((await send(context,'expenses','POST',expense,token)).status(),422);
    assert.equal((await send(context,`expenses/${eid}`,'PATCH',{...expense,amount:'20,01'},token)).status(),200);
    assert.equal((await send(context,`categories/${expense.category_id}`,'PATCH',{archived:false},token)).status(),200);
    assert.equal((await send(context,'settings','PATCH',{currency:'USD'},token)).status(),409);
    assert.equal((await send(simultaneous[1],`expenses/${eid}`)).status(),404);
    passed('Categories create, rename and archive safely; archived history, duplicate prevention, currency lock and workspace isolation hold');
    // Use the attacking client's own valid CSRF token and configured currency.
    const attacker=simultaneous[1], attackerWorkspace=owned[2], attackerToken=sessions[1].csrf;
    assert.equal((await send(attacker,'settings','PATCH',{currency:'EUR'},attackerToken)).status(),200);
    const attackerCategories=await (await send(attacker,'categories')).json();
    const attackerExpense={...expense,concept:'QA · Espacio atacante',category_id:attackerCategories[0].id};
    assert.equal((await send(attacker,'expenses','POST',attackerExpense,attackerToken)).status(),201);
    const victimBefore=await snapshot(workspace), attackerBefore=await snapshot(attackerWorkspace);
    const isolationCases=[
      [`expenses/${eid}`,'PATCH',{...attackerExpense,amount:'99'},404],
      [`expenses/${eid}`,'DELETE',undefined,404],
      [`categories/${cid}`,'PATCH',{name:'QA · Intento extranjero'},404],
      [`categories/${cid}`,'PATCH',{archived:true},404],
      ['expenses','POST',{...attackerExpense,category_id:expense.category_id},422]
    ];
    for(const [resource,method,data,status]of isolationCases){
      assert.equal((await send(attacker,resource,method,data,attackerToken)).status(),status);
      assert.deepEqual(await snapshot(workspace),victimBefore);
      assert.deepEqual(await snapshot(attackerWorkspace),attackerBefore);
    }
    passed('Own-token cross-workspace edit, delete, category rename/archive and foreign-category creation are denied with both persisted workspaces unchanged');
    // Reject mutations targeting established IDs and compare the complete persisted workspace.
    const secureSnapshot=await snapshot(workspace);
    for (const [resource,method,data] of [[`expenses/${eid}`,'PATCH',{...expense,amount:'99'}],[`expenses/${eid}`,'DELETE',undefined],[`categories/${cid}`,'PATCH',{archived:true}]]) {
      assert.equal((await send(context,resource,method,data,sessions[1].csrf)).status(),403);
      assert.equal((await send(context,resource,method,data,token,'https://unauthorized.example')).status(),403);
    }
    assert.deepEqual(await snapshot(workspace),secureSnapshot);
    passed('Rejected edit, delete and category mutations leave existing persisted rows unchanged');
    for (const [name,width,height] of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844],['small-mobile',320,740]]) {
      await page.setViewportSize({width,height}); await page.reload(); await page.getByRole('button',{name:'Editar '+expense.concept,exact:true}).waitFor();
      if(await page.getByRole('button',{name:'Cerrar confirmación'}).count()) await page.getByRole('button',{name:'Cerrar confirmación'}).click();
      await page.evaluate(()=>document.fonts.ready);
      const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1, firstRecord:document.querySelector('li')?.getBoundingClientRect().top, searchHeight:document.getElementById('search').getBoundingClientRect().height,categoryHeight:document.getElementById('category-filter').getBoundingClientRect().height}));
      assert.equal(metrics.overflow,false); assert(metrics.searchHeight>=44 && metrics.categoryHeight>=44);
      if(name==='mobile') assert(metrics.firstRecord<460,`First mobile expense starts at ${metrics.firstRecord}`);
      assert(await page.locator('label[for="search"]').isVisible()); assert(await page.locator('label[for="category-filter"]').isVisible());
      if(evidenceDir) await page.screenshot({path:path.join(evidenceDir,`populated-${name}.png`),fullPage:true});
      passed(`Responsive ${width}px: visible associated labels, 44px inputs, complete records and no page overflow`);
    }
    await page.setViewportSize({width:390,height:844});
    const breakdownButton=page.getByRole('button',{name:'Ver por categorías',exact:true});
    await breakdownButton.focus(); await page.keyboard.press('Enter'); await dialog.waitFor();
    await dialog.getByRole('heading',{name:'Por categorías',exact:true}).waitFor(); await assertOverlay(page);
    assert.equal(await dialog.locator('[data-breakdown-category]').count(),1);
    assert.match(await dialog.locator('[data-breakdown-category]').innerText(),/100 %/);
    assert.match(await dialog.locator('[data-breakdown-category]').innerText(),/20,01/);
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
    await page.waitForTimeout(50); assert(await breakdownButton.evaluate(el=>el===document.activeElement));
    await page.getByRole('button',{name:'Mes anterior',exact:true}).click();
    await page.getByText('Todavía no has registrado gastos este mes',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Mes siguiente',exact:true}).click();
    await page.getByRole('button',{name:'Editar '+expense.concept,exact:true}).waitFor();
    await page.getByRole('button',{name:'EUR',exact:true}).click(); await dialog.waitFor();
    assert(await dialog.getByLabel('Moneda',{exact:true}).isDisabled());
    await dialog.getByRole('button',{name:'Entendido',exact:true}).click(); await dialog.waitFor({state:'hidden'});
    passed('Month navigation, keyboard-opened category breakdown, closed-state focus return and visible currency lock work');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{window.__qaPanelAnimation=false; document.addEventListener('animationstart',event=>{if(event.animationName==='panel-in' && event.target.matches('[role="dialog"]'))window.__qaPanelAnimation=true;},{once:true});});
    const add=page.getByRole('button',{name:'Añadir gasto',exact:true}).first(); await add.focus(); await page.keyboard.press('Enter'); await dialog.waitFor();
    const motion=await dialog.evaluate(el=>({name:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration}));
    assert.equal(motion.name,'panel-in'); assert.equal(motion.duration,'0.18s'); await page.waitForFunction(()=>window.__qaPanelAnimation===true);
    await page.waitForTimeout(200); assert.equal(await page.locator('#concept').evaluate(el=>el===document.activeElement),true);
    for(let n=0;n<12;n++) {await page.keyboard.press('Tab'); assert(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')));}
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'}); await page.waitForTimeout(50); assert(await add.evaluate(el=>el===document.activeElement));
    await page.emulateMedia({reducedMotion:'reduce'}); await add.click(); await dialog.waitFor();
    assert.equal(await dialog.evaluate(el=>getComputedStyle(el).animationName),'none'); assert.equal(await dialog.evaluate(el=>el.getAnimations().length),0);
    if(evidenceDir)await page.screenshot({path:path.join(evidenceDir,'reduced-motion-form-mobile.png'),fullPage:false});
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
    passed('Panel animation is present normally and immediate with reduced motion; keyboard focus is trapped and restored');
    await page.getByRole('button',{name:'Eliminar '+expense.concept,exact:true}).click(); await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    assert.equal((await send(context,`expenses/${eid}`)).status(),200);
    await page.getByRole('button',{name:'Eliminar '+expense.concept,exact:true}).click(); await page.getByRole('button',{name:'Eliminar gasto',exact:true}).click(); await dialog.waitFor({state:'hidden'});
    await page.reload(); await page.getByText('Todavía no has registrado gastos este mes',{exact:true}).waitFor();
    assert.equal((await (await send(context,'monthly?month=2026-10')).json()).total,0);
    assert.equal((await send(context,`expenses/${eid}`)).status(),404); assert.deepEqual(browserErrors,[]);
    passed('Delete confirmation cancels safely, confirmed deletion survives reload and monthly summary returns to zero');
    // Stress records belong solely to a fresh QA workspace; preserved records are never changed.
    const stressContext=simultaneous[2], stressToken=sessions[2].csrf;
    assert.equal((await send(stressContext,'settings','PATCH',{currency:'EUR'},stressToken)).status(),200);
    const longCategory='QA · '+ 'CategoríaSinEspacios'.repeat(3).slice(0,55);
    const categoryResponse=await send(stressContext,'categories','POST',{name:longCategory},stressToken); assert.equal(categoryResponse.status(),201);
    const longId=(await categoryResponse.json()).id;
    const secondId=(await (await send(stressContext,'categories')).json()).find(c=>c.id!==longId).id;
    const longConcept='QA · '+ 'ConceptoSinEspacios'.repeat(7).slice(0,115);
    const stressRecords=[
      {concept:longConcept,amount:'9999999999.99',date:'2026-10-31',category_id:longId,note:'QA · Prueba temporal de límites'},
      {concept:'QA · Segunda categoría octubre',amount:'20.01',date:'2026-10-01',category_id:secondId,note:''},
      {concept:'QA · Mes adyacente primera categoría',amount:'1.23',date:'2026-09-30',category_id:longId,note:''},
      {concept:'QA · Mes adyacente segunda categoría',amount:'4.56',date:'2026-09-01',category_id:secondId,note:''}
    ];
    for(const record of stressRecords)assert.equal((await send(stressContext,'expenses','POST',record,stressToken)).status(),201);
    for(const [month,total,values] of [['2026-10',1000000002000,[999999999999,2001]],['2026-09',579,[123,456]]]) {
      const summary=await (await send(stressContext,'monthly?month='+month)).json();
      assert.equal(summary.total,total); assert.equal(summary.count,2); assert.equal(summary.categories.length,2);
      for(const [i,id]of [longId,secondId].entries()){const entry=summary.categories.find(c=>c.id===id);assert.equal(entry.total,values[i]);assert.equal(entry.count,1);}
      const rows=await (await send(stressContext,'expenses?month='+month)).json();assert.equal(rows.length,2);assert(rows.every(r=>r.date.startsWith(month)));
    }
    passed('Exact two-category totals and counts in adjacent months exclude boundary dates and preserve large integer amounts');
    const stressPage=await stressContext.newPage();
    for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[320,740]]) {
      await stressPage.setViewportSize({width,height});await stressPage.goto(baseUrl);await stressPage.getByLabel('Mes y año',{exact:true}).fill('2026-10');
      await stressPage.getByRole('button',{name:'Editar '+longConcept,exact:true}).waitFor();await stressPage.evaluate(()=>document.fonts.ready);
      const assertBounds=async root=>{
        const failures=await root.evaluate(el=>Array.from(el.querySelectorAll('li p,li span,li button,[data-breakdown-category], [data-breakdown-category] span, [data-breakdown-category] p')).filter(n=>getComputedStyle(n).display!=='none' && n.getBoundingClientRect().width>0).flatMap(n=>{
          const r=n.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1 || n.scrollWidth>n.clientWidth+1 ? [{text:n.textContent,left:r.left,right:r.right,scroll:n.scrollWidth,client:n.clientWidth}] : [];
        }));assert.deepEqual(failures,[]);
        assert.equal(await stressPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      };
      await assertBounds(stressPage.locator('main'));
      const total=stressPage.getByRole('region',{name:'Resumen del mes'}).locator('[data-monthly-total]');
      const expectedTotal=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',currencyDisplay:'code'}).format(1000000002000/100);
      await total.waitFor();assert.equal(await total.innerText(),expectedTotal);
      const totalBounds=await total.evaluate(el=>{
        const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
        const glyphs=Array.from(range.getClientRects()).map(g=>({left:g.left,right:g.right,top:g.top,bottom:g.bottom}));
        const ancestors=[];for(let node=el;node;node=node.parentElement){const box=node.getBoundingClientRect(),style=getComputedStyle(node);ancestors.push({left:box.left,right:box.right,top:box.top,bottom:box.bottom,x:style.overflowX,y:style.overflowY});}
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,glyphs,ancestors};
      });
      assert(totalBounds.left>=0&&totalBounds.right<=width&&totalBounds.top>=0&&totalBounds.bottom<=height,JSON.stringify(totalBounds));
      assert(totalBounds.scrollWidth<=totalBounds.clientWidth+1&&totalBounds.scrollHeight<=totalBounds.clientHeight+1);
      for(const g of totalBounds.glyphs){
        assert(g.left>=totalBounds.left-1&&g.right<=totalBounds.right+1&&g.top>=totalBounds.top-1&&g.bottom<=totalBounds.bottom+1);
        for(const a of totalBounds.ancestors){if(['hidden','clip','auto','scroll'].includes(a.x))assert(g.left>=a.left-1&&g.right<=a.right+1);if(['hidden','clip','auto','scroll'].includes(a.y))assert(g.top>=a.top-1&&g.bottom<=a.bottom+1);}
      }
      passed('Exact maximum monthly total is fully readable without clipping at '+width+'px');
      if(width===320){
        const monthLabel=stressPage.getByLabel('Mes y año',{exact:true}).locator('..');
        assert.equal(await monthLabel.locator('[aria-hidden="true"]').innerText(),'oct 2026');
        assert.equal(await monthLabel.locator('.sr-only').last().innerText(),'octubre de 2026');
        const nav=await Promise.all(['Mes anterior','Mes siguiente'].map(name=>stressPage.getByRole('button',{name,exact:true}).boundingBox()));assert(nav.every(r=>r.width>=44&&r.height>=44));
        passed('320px abbreviated month stays on one line with full accessible date and 44px navigation');
      }
      if(width===768){const action=await stressPage.getByRole('region',{name:'Resumen del mes'}).getByRole('button',{name:'Añadir gasto',exact:true}).boundingBox();const summary=await stressPage.getByRole('region',{name:'Resumen del mes'}).boundingBox();assert(Math.abs(action.x+action.width-summary.x-summary.width)<=1);passed('Tablet summary action aligns to the right edge');}
      const checkBreakdown=async root=>{
        assert.equal(await root.locator('[data-breakdown-category]').count(),2);
        for(const [id,amount]of [[longId,999999999999],[secondId,2001]]) {
          const formatted=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',currencyDisplay:'code'}).format(amount/100);
          assert((await root.locator('[data-breakdown-category="'+id+'"]').innerText()).includes(formatted));
        }
      };
      if(width>=1024)await checkBreakdown(stressPage.locator('aside'));
      assert.equal(await stressPage.locator('#search').getAttribute('placeholder'),'Buscar');
      assert.equal(await stressPage.locator('#category-filter option').first().textContent(),'Todas');
      if(width===320){
        const widths=await stressPage.evaluate(()=>{const input=document.getElementById('search'),select=document.getElementById('category-filter'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=getComputedStyle(input).font;const search=ctx.measureText(input.placeholder).width;ctx.font=getComputedStyle(select).font;return {search,searchSpace:input.clientWidth-52,category:ctx.measureText('Todas').width,categorySpace:select.clientWidth-36}});
        assert(widths.search<=widths.searchSpace && widths.category<=widths.categorySpace,JSON.stringify(widths));
      }
      if(evidenceDir)await stressPage.screenshot({path:path.join(evidenceDir,'long-records-'+width+'.png'),fullPage:true});
      if(width<1024){await stressPage.getByRole('button',{name:'Ver por categorías',exact:true}).click();await stressPage.getByRole('dialog').waitFor();await assertOverlay(stressPage);await assertBounds(stressPage.getByRole('dialog'));await checkBreakdown(stressPage.getByRole('dialog'));await stressPage.waitForTimeout(220);if(evidenceDir)await stressPage.screenshot({path:path.join(evidenceDir,'long-breakdown-'+width+'.png'),fullPage:false});await stressPage.keyboard.press('Escape');await stressPage.getByRole('dialog').waitFor({state:'hidden'});}
      await stressPage.getByRole('button',{name:'Categorías',exact:true}).click();await stressPage.getByText(longCategory,{exact:true}).waitFor();
      const categoryBounds=await stressPage.getByText(longCategory,{exact:true}).evaluate(el=>({right:el.getBoundingClientRect().right,overflow:el.scrollWidth>el.clientWidth+1}));assert(categoryBounds.right<=width+1 && !categoryBounds.overflow);
      passed('Executed '+width+'px long concept/category and maximum amount bounds, full overlay and compact defaults');
    }
    await stressPage.setViewportSize({width:390,height:844});await stressPage.reload();await stressPage.getByRole('button',{name:'Editar '+longConcept,exact:true}).waitFor();await stressPage.getByLabel('Mes y año',{exact:true}).fill('2026-09');
    await stressPage.getByRole('button',{name:'Editar QA · Mes adyacente primera categoría',exact:true}).waitFor();
    assert.match(await stressPage.getByRole('region',{name:'Resumen del mes'}).innerText(),/5,79/);
    if(evidenceDir)await stressPage.screenshot({path:path.join(evidenceDir,'adjacent-month-mobile.png'),fullPage:true});
    passed('Adjacent-month browser navigation survives reload with exact displayed total');
    await stressPage.reload();
    await stressPage.getByRole('button',{name:'Editar QA · Mes adyacente primera categoría',exact:true}).waitFor();
    await stressPage.getByRole('button',{name:'Editar QA · Mes adyacente segunda categoría',exact:true}).waitFor();
    assert.equal(await stressPage.getByLabel('Mes y año',{exact:true}).inputValue(),'2026-09');
    assert.equal(await stressPage.getByRole('region',{name:'Resumen del mes'}).locator('[data-monthly-total]').innerText(),new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',currencyDisplay:'code'}).format(5.79));
    assert.equal(await stressPage.locator('li').count(),2);
    if(evidenceDir)await stressPage.screenshot({path:path.join(evidenceDir,'adjacent-month-after-reload.png'),fullPage:true});
    passed('Supplemental reload after September selection retains selected month, exact 5,79 EUR total and both September records');
    const current=await snapshot();
    for(const table of Object.keys(baseline)) for(const row of baseline[table]) assert.deepEqual(current[table].find(r=>r.id===row.id),row);
    passed('All pre-existing records, including preserved QA records, remain unchanged');
    return {verified:true,checks};
  } finally {
    for(const context of contexts)await context.close();
    // Only remove workspaces created by this execution; leave existing QA and user data intact.
    for(const id of owned) await db.batch(['expense','category','session','workspace'].map(table=>({sql:`DELETE FROM ${table} WHERE ${table==='workspace'?'id':'workspace_id'}=?`,args:[id]})),'write');
    db.close();
  }
};
if(require.main===module) (async()=>{
  const {chromium}=require('/tmp/constructor-quality-tools/node_modules/playwright'); const browser=await chromium.launch({args:['--no-sandbox']});
  const evidenceDir=process.env.EVIDENCE_DIR||'/tmp/constructor-quality'; await fs.mkdir(evidenceDir,{recursive:true});
  try {const result=await exports.verify({browser,baseUrl:process.env.BASE_URL||'http://127.0.0.1:3100',evidenceDir}); await fs.writeFile(path.join(evidenceDir,'interaction-evidence.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));} finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
