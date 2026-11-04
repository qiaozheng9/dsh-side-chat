/** Actual Desktop verification; only synthetic chats are inspected. */
import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
const home='C:/Users/QiaoZheng/.dsh',out=resolve('test-results/installed')
const port=(await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort','utf8')).split(/\r?\n/)[0]
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('dsh-app://app/'))
const report={version:'0.2.3',checks:{},created:[]},errors=[]
page.on('pageerror',error=>errors.push(error.message))
const save=()=>writeFile(join(out,'empty-state-0.2.3.json'),JSON.stringify(report,null,2))
const main=()=>page.locator('[data-slot="main.conversation"]').first()
const side=()=>page.locator('[data-dsh-native-side-chat]:visible').last()
const input=()=>side().locator('[data-composer-input]')
const dialog=()=>page.getByRole('dialog',{name:'关闭此侧边对话？'})
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex')
async function api(method,payload={}) {return page.evaluate(async({method,payload})=>{const r=await(await fetch(`/side-chat/api/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).json();if(!r.ok)throw Error(r.error?.message);return r.value},{method,payload})}
async function file(id){for(const group of await readdir(join(home,'sessions'),{withFileTypes:true}))if(group.isDirectory()){const p=join(home,'sessions',group.name,id,'session.v4.jsonl.zstd');try{await access(p);return p}catch{/* inspect this exact synthetic identity only */}}}
async function open(){const response=page.waitForResponse(r=>r.url().endsWith('/side-chat/api/sidechat.start'));await main().locator('[data-composer-input]').fill('/side');await main().locator('[data-composer-input]').press('Enter');const r=await(await response).json();if(!r.ok)throw Error(r.error?.message);const id=r.value.childId;report.created.push(id);await save();await expect(side().locator('[data-conversation-content]')).toHaveAttribute('data-conversation-session',id,{timeout:30000});await expect(input()).toBeEditable();return id}
async function removed(id){await expect(page.locator(`[data-child-session="${id}"]`)).toHaveCount(0,{timeout:30000});await expect.poll(()=>file(id),{timeout:15000}).toBeUndefined();expect((await api('sidechat.temporary')).childIds).not.toContain(id);await expect(dialog()).toHaveCount(0)}
async function capture(path){const clip=await side().boundingBox(),cdp=await page.context().newCDPSession(page);try{const png=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{...clip,scale:1}});await writeFile(path,Buffer.from(png.data,'base64'))}finally{await cdp.detach()}}
try{
  await page.getByRole('button',{name:'新建会话',exact:true}).first().click()
  await expect(main().locator('[data-conversation-content]')).toHaveAttribute('data-content-phase','hero',{timeout:15000})
  await expect(main().getByRole('button',{name:'侧边对话',exact:true})).toHaveCount(0)
  let startCount=0;page.on('request',r=>{if(r.url().endsWith('/side-chat/api/sidechat.start'))startCount++})
  await main().locator('[data-composer-input]').fill('/side')
  await expect(page.locator('[data-trigger-menu] [role="option"]').filter({hasText:/side/i})).toHaveCount(0)
  await main().locator('[data-composer-input]').press('Enter')
  await expect(page.getByText('当前对话没有 /side 命令，请先开始主对话。',{exact:false})).toBeVisible({timeout:15000})
  expect(startCount).toBe(0);await expect(main().locator('[data-chat-flow-key]')).toHaveCount(0)
  report.checks.unavailableInEmptyMainWithoutModelTurn=true;await save()
  await main().locator('[data-composer-input]').fill('这是空白侧边交互验收：请记住校验词 EMPTY_WELCOME_NOV04。本条消息只回复 PARENT_OK，以后按问题正常回答，不调用工具。')
  await main().locator('[data-composer-input]').press('Enter')
  await expect(main().getByText('PARENT_OK',{exact:true})).toBeVisible({timeout:120000})
  await expect(main().getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0,{timeout:15000})
  report.parentId=await main().locator('[data-conversation-content]').getAttribute('data-conversation-session')
  report.parentFile=await file(report.parentId)
  let prior,stable=0;for(let i=0;i<30;i++){const current=await hash(report.parentFile);stable=current===prior?stable+1:0;prior=current;if(stable>=6)break;await page.waitForTimeout(500)}report.parentHash=prior
  await expect(main().getByRole('button',{name:'侧边对话',exact:true})).toBeVisible()
  const first=await open()
  await expect(side().locator('[data-side-welcome] svg')).toBeVisible()
  await expect(side().locator('[data-chat-flow-key]')).toHaveCount(0)
  expect((await api('sidechat.info',{childId:first})).hasConversation).toBe(false)
  await capture(join(out,'empty-state-welcome.png'))
  report.checks.nativeLogoAndContextWelcome=true
  await side().getByRole('button',{name:'关闭侧边对话',exact:true}).click();await removed(first)
  report.checks.emptyHeaderCloseWithoutDialog=true;await save()
  const second=await open()
  await page.getByRole('tab',{name:/^侧边对话/}).last().getByRole('button',{name:'关闭',exact:true}).click();await removed(second)
  report.checks.emptyTabStripCloseWithoutDialog=true
  const third=await open()
  await input().fill('我刚才让你记住的校验词是什么？只回复校验词。');await input().press('Enter')
  await expect(side().locator('[data-side-welcome]')).toHaveCount(0,{timeout:15000})
  await side().getByRole('button',{name:'关闭侧边对话',exact:true}).click()
  await expect(dialog()).toBeVisible({timeout:15000});await dialog().getByRole('button',{name:'取消',exact:true}).click()
  await expect(side().getByText('EMPTY_WELCOME_NOV04',{exact:true})).toBeVisible({timeout:120000})
  await expect.poll(async()=>(await api('sidechat.info',{childId:third})).status,{timeout:120000}).toBe('idle')
  expect((await api('sidechat.info',{childId:third})).hasConversation).toBe(true)
  await expect(side().locator('[data-side-welcome]')).toHaveCount(0)
  await side().getByRole('button',{name:'关闭侧边对话',exact:true}).click();await dialog().getByRole('button',{name:'删除并关闭',exact:true}).click();await removed(third)
  report.checks.sentMessageRequiresConfirmationAndKeepsContext=true
  const fourth=await open();await input().fill('未发送的草稿')
  await expect(side().locator('[data-side-welcome]')).toBeVisible()
  await side().getByRole('button',{name:'关闭侧边对话',exact:true}).click();await removed(fourth)
  expect(await page.evaluate(id=>Object.keys(localStorage).filter(k=>k.includes(id)).length,fourth)).toBe(0)
  report.checks.draftOnlyCloseDeletesWithoutDialog=true
  const remaining=(await api('sidechat.temporary')).childIds
  for(const id of report.created)expect(remaining).not.toContain(id)
  expect(await hash(report.parentFile)).toBe(report.parentHash)
  report.checks.allTemporaryDataDeletedAndParentUnchanged=true
  expect(errors).toEqual([]);report.result='passed';await save();console.log(JSON.stringify({result:report.result,checks:report.checks}))
}catch(error){report.result='failed';report.error=String(error).split('\n').slice(0,5).join('\n');report.errors=errors;await save();console.error(report.error);process.exitCode=1}finally{await browser.close()}
