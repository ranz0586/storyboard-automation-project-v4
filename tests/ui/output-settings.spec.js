import { test, expect } from '@playwright/test';

async function registerProject(page, name) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  for (const [label,value] of Object.entries({ 'Full name': 'Output Tester', Email: name + '@example.com', Username: name, Password: 'test-password-123' })) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('button',{name:'+ New project',exact:true}).click();
  for(const [label,value] of Object.entries({'Project name':name,Niche:'Science',Platform:'YouTube','Target audience':'Adults','Content style':'Illustrated demonstration'})) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await page.getByRole('tab',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Structure 1',exact:true})).toBeChecked();
}
const tab = (page,name) => page.getByRole('tab',{name,exact:true}).click();
const state = async request => (await request.get('/__test/state')).json();

test('selected-only output and guidance freeze through failure, changed defaults, retry and storyboard conversion', async ({page,request}) => {
  await registerProject(page,'selected-output');
  const project=(await state(request)).projects.find(row=>row.fields.channel_page_name==='selected-output');
  const one=page.getByRole('checkbox',{name:'Structure 1',exact:true}),two=page.getByRole('checkbox',{name:'Structure 2',exact:true}),three=page.getByRole('checkbox',{name:'Structure 3',exact:true});
  await page.getByLabel('Narration language',{exact:true}).fill('English');
  await page.getByLabel('Target duration (seconds)',{exact:true}).fill('30');
  await page.getByLabel('Character reference description',{exact:true}).fill('Blue coat and round glasses');
  await page.getByLabel('Style reference description',{exact:true}).fill('Ink illustration with warm light');
  await one.uncheck(); await three.uncheck();
  await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible();
  expect(await page.getByRole('checkbox',{name:'Select all structures',exact:true}).evaluate(el=>el.indeterminate)).toBeTruthy();
  await two.uncheck(); await expect(page.getByRole('button',{name:'Save production brief',exact:true})).toBeDisabled();
  await two.check(); await page.getByRole('button',{name:'Save production brief',exact:true}).click();
  await expect(page.getByText('Production brief saved for new scripts',{exact:true})).toBeVisible();
  await page.reload(); await page.getByRole('navigation',{name:'Projects'}).getByRole('button',{name:'selected-output',exact:true}).click();
  await tab(page,'Settings'); await expect(two).toBeChecked(); await expect(one).not.toBeChecked(); await expect(three).not.toBeChecked();
  await expect(page.getByLabel('Narration language',{exact:true})).toHaveValue('English');
  await expect(page.getByLabel('Target duration (seconds)',{exact:true})).toHaveValue('30');
  await expect(page.getByLabel('Character reference description',{exact:true})).toHaveValue('Blue coat and round glasses');
  await expect(page.getByLabel('Style reference description',{exact:true})).toHaveValue('Ink illustration with warm light');
  await page.getByText('Guidance versions',{exact:true}).click(); await expect(page.locator('.creative-guidance li')).toHaveCount(4);
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000});
    await page.locator('.output-settings').scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.locator('.output-settings').screenshot({path:`test-results/production-brief-${width}.png`});
  }
  await page.setViewportSize({width:1280,height:900});
  await request.post('/__test/fail-script');
  await tab(page,'Ideas');await page.getByLabel('Pipeline concept count',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Run full pipeline',exact:true}).click();
  await tab(page,'Activity');await expect(page.getByText('Simulated provider outage',{exact:false}).first()).toBeVisible();
  await tab(page,'Settings');await one.check();await two.uncheck();
  await page.getByLabel('Narration language',{exact:true}).fill('French');
  await page.getByLabel('Target duration (seconds)',{exact:true}).fill('60');
  await page.getByLabel('Character reference description',{exact:true}).fill('Red coat');
  await page.getByLabel('Style reference description',{exact:true}).fill('Watercolor');
  await page.getByRole('button',{name:'Save production brief',exact:true}).click();await expect(page.getByText('Production brief saved for new scripts',{exact:true})).toBeVisible();
  await tab(page,'Activity');await page.getByRole('button',{name:'Retry failures',exact:true}).click();
  await expect.poll(async()=>(await state(request)).scripts.filter(row=>row.fields.Projects===project.fields.project_id).length).toBe(1);
  await page.getByRole('button',{name:'Refresh project',exact:true}).click();await tab(page,'Scripts');
  await page.locator('#scripts > details > summary').click();
  await page.getByText('Frozen production settings',{exact:true}).click();
  await expect(page.locator('.frozen-outputs')).toContainText('Outputs: Structure 2');
  await expect(page.locator('.frozen-outputs')).toContainText('truthful-hooks@1');
  await expect(page.locator('.frozen-outputs')).toContainText('Narration language: English');
  await expect(page.locator('.frozen-outputs')).toContainText('30 seconds (planning target)');
  await expect(page.locator('.frozen-outputs')).toContainText('Blue coat and round glasses');
  await expect(page.locator('.frozen-outputs')).toContainText('Ink illustration with warm light');
  await page.getByRole('button',{name:'Approve for storyboard',exact:true}).click();
  const result=await (await request.post('/__test/storyboard/'+project.id)).json();expect(result.generated).toBe(1);
  const saved=(await state(request)).storyboards.find(row=>row.fields.project_id===project.fields.project_id);
  const output=JSON.parse(saved.fields.storyboard_text);
  expect(output.production_brief.language).toBe('English');expect(output.production_brief.durationSeconds).toBe(30);
  expect(output.production_brief.characterReferences).toBe('Blue coat and round glasses');expect(output.production_brief.styleReferences).toBe('Ink illustration with warm light');
  expect(output.structure2.length).toBeGreaterThan(0);expect(output.structure1).toBeUndefined();expect(output.structure3).toBeUndefined();
  expect(output.production_brief.structures).toEqual(['structure2']);expect(output.production_brief.guidancePacks).toHaveLength(4);expect(output.production_brief.origin).toBe('script');
  await page.getByRole('button',{name:'Refresh project',exact:true}).click();await tab(page,'Storyboards');
  await page.locator('#storyboards > details > summary').click();
  await expect(page.getByRole('region',{name:'Structure 2',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Structure 1',exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Structure 3',exact:true})).toHaveCount(0);
});

test('output settings expose a retry after a failed read and keep unsaved selection across tabs',async({page})=>{
  await registerProject(page,'output-errors');
  let fail=true;
  await page.route('**/api/projects/*/brief',route=>fail&&route.request().method()==='GET'?route.fulfill({status:503,json:{error:'Outputs temporarily unavailable'}}):route.continue());
  await page.reload();await page.getByRole('navigation',{name:'Projects'}).getByRole('button',{name:'output-errors',exact:true}).click();await tab(page,'Settings');
  await expect(page.getByText('Outputs temporarily unavailable',{exact:true})).toBeVisible();fail=false;
  await page.getByRole('button',{name:'Retry loading brief',exact:true}).click();await page.getByRole('checkbox',{name:'Structure 1',exact:true}).uncheck();
  await page.getByLabel('Narration language',{exact:true}).fill('Spanish');
  await page.getByLabel('Target duration (seconds)',{exact:true}).fill('45');
  await page.getByLabel('Character reference description',{exact:true}).fill('Green coat');
  await tab(page,'Ideas');await tab(page,'Settings');await expect(page.getByRole('checkbox',{name:'Structure 1',exact:true})).not.toBeChecked();
  await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Narration language',{exact:true})).toHaveValue('Spanish');
  await expect(page.getByLabel('Target duration (seconds)',{exact:true})).toHaveValue('45');
  await expect(page.getByLabel('Character reference description',{exact:true})).toHaveValue('Green coat');
});
