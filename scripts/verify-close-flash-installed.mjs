/** Observe the entire close interval in synthetic native conversations. */
/* global document, window, MutationObserver, getComputedStyle, requestAnimationFrame */
import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
const out=resolve('test-results/installed'),version=process.argv.includes('--expect-clean')?'fixed':'before'
const port=(await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort','utf8')).split(/\r?\n/)[0]
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('dsh-app://app/'))
const report={version,cases:[],consoleErrors:[],created:[]}
page.on('console',message=>{if(message.type()==='error'&&/slot entry crashed|dsh-side-chat|uiConversation.binding|disposed|session.*not found/i.test(message.text()))report.consoleErrors.push(message.text().slice(0,700))})
page.on('pageerror',error=>report.consoleErrors.push(error.message.slice(0,700)))
const side=()=>page.locator('[data-dsh-native-side-chat]:visible').last()
const main=()=>page.locator('[data-slot="main.conversation"]').first()
const save=()=>writeFile(join(out,`close-flash-${version}.json`),JSON.stringify(report,null,2))
async function api(method,payload={}){return page.evaluate(async({method,payload})=>{const r=await(await fetch(`/side-chat/api/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).json();if(!r.ok)throw Error(r.error?.message);return r.value},{method,payload})}
async function sessionFile(id){const home='C:/Users/QiaoZheng/.dsh/sessions';for(const group of await readdir(home,{withFileTypes:true}))if(group.isDirectory()){const file=join(home,group.name,id,'session.v4.jsonl.zstd');try{await access(file);return file}catch{/* exact synthetic identity only */}}}
async function monitor(id){await page.evaluate(id=>{
  const panel=[...document.querySelectorAll('[data-dsh-native-side-chat]')].find(el=>el.getAttribute('data-child-session')===id)
  const scope=panel.closest('[data-slot="sidebar.right.pane.tab"]')??panel.parentElement
  const trace=[],seen=new Set();let stopped=false
  function capture(){for(const el of scope.querySelectorAll('[role="alert"], [data-slot-error], [class*="error" i]')){
    const text=el.textContent?.trim();if(!text||seen.has(text)||el.getBoundingClientRect().height===0)continue
    const color=getComputedStyle(el).color;seen.add(text);trace.push({ms:performance.now(),text:text.slice(0,700),color})
  }}
  const observer=new MutationObserver(capture);observer.observe(scope,{subtree:true,childList:true,characterData:true,attributes:true})
  function frame(){if(stopped)return;capture();requestAnimationFrame(frame)}requestAnimationFrame(frame)
  window.__closeFlash={finish(){capture();stopped=true;observer.disconnect();return trace}}
},id)}
try{
  await page.getByRole('button',{name:'新建会话',exact:true}).first().click()
  await expect(main().locator('[data-conversation-content]')).toHaveAttribute('data-content-phase','hero',{timeout:15000})
  await main().locator('[data-composer-input]').fill('这是关闭闪红错误的专用验收。本条消息只回复 PARENT_OK，以后正常回答，不调用工具。')
  await main().locator('[data-composer-input]').press('Enter')
  await expect(main().getByText('PARENT_OK',{exact:true})).toBeVisible({timeout:120000})
  for(const [question,gesture] of [['','header'],['','tab'],['只回复 CLOSE_CHECK_OK','header']]){
    const response=page.waitForResponse(r=>r.url().endsWith('/side-chat/api/sidechat.start'))
    await main().locator('[data-composer-input]').fill(`/side${question?' '+question:''}`);await main().locator('[data-composer-input]').press('Enter')
    const result=await(await response).json();if(!result.ok)throw Error(result.error?.message)
    const id=result.value.childId;report.created.push(id);await save()
    await expect(side().locator('[data-conversation-content]')).toHaveAttribute('data-conversation-session',id,{timeout:30000})
    if(question){await expect(side().getByText('CLOSE_CHECK_OK',{exact:true})).toBeVisible({timeout:120000});await expect.poll(async()=>(await api('sidechat.info',{childId:id})).status,{timeout:120000}).toBe('idle')}
    await monitor(id)
    if(gesture==='tab')await page.getByRole('tab',{name:/^侧边对话/}).last().getByRole('button',{name:'关闭',exact:true}).click()
    else await side().getByRole('button',{name:'关闭侧边对话',exact:true}).click()
    if(question)await page.getByRole('dialog',{name:'关闭此侧边对话？'}).getByRole('button',{name:'删除并关闭',exact:true}).click()
    await expect(page.locator(`[data-child-session="${id}"]`)).toHaveCount(0,{timeout:30000})
    await page.waitForTimeout(300)
    const trace=await page.evaluate(()=>window.__closeFlash.finish())
    await expect.poll(()=>sessionFile(id),{timeout:15000}).toBeUndefined()
    expect((await api('sidechat.temporary')).childIds).not.toContain(id)
    report.cases.push({kind:question?'chatted':'empty',gesture,trace,deleted:true});await save()
    if(process.argv.includes('--expect-clean'))expect(trace).toEqual([])
  }
  if(process.argv.includes('--expect-clean'))expect(report.consoleErrors).toEqual([])
  report.result='passed';await save();console.log(JSON.stringify(report))
}catch(error){report.result='failed';report.error=String(error).split('\n').slice(0,5).join('\n');await save();console.error(report.error);process.exitCode=1}finally{await browser.close()}
