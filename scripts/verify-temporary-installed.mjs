/** Installed Desktop test: synthetic conversations only, never dump the page. */
/* global window, document, MutationObserver */
import { readFile, writeFile, readdir, access, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
const home = 'C:/Users/QiaoZheng/.dsh'
const out = resolve('test-results/installed'), stateFile = join(out, 'temporary-0.2.2.json')
const port = (await readFile('C:/Users/QiaoZheng/AppData/Roaming/@deepseek-ai/dsh-desktop/DevToolsActivePort','utf8')).split(/\r?\n/)[0]
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('dsh-app://app/'))
const report = { version: '0.2.2', checks: {}, created: [] }, errors = []
page.on('pageerror', e => errors.push(e.message))
const save = () => writeFile(stateFile, JSON.stringify(report, null, 2))
const main = () => page.locator('[data-slot="main.conversation"]').first()
const side = () => page.locator('[data-dsh-native-side-chat]:visible').last()
const input = () => side().locator('[data-composer-input]')
const hash = path => readFile(path).then(bytes => createHash('sha256').update(bytes).digest('hex'))
const exists = path => access(path).then(() => true, () => false)
const registry = join(home, 'storages/dsh-side-chat/temporary-sessions.json')
async function api(method, payload = {}) {
  return page.evaluate(async ({method,payload}) => {
    const r=await (await fetch(`/side-chat/api/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).json()
    if(!r.ok)throw Error(r.error?.message);return r.value
  },{method,payload})
}
async function sessionFile(id) {
  for(const group of await readdir(join(home,'sessions'),{withFileTypes:true}))if(group.isDirectory()){
    const file=join(home,'sessions',group.name,id,'session.v4.jsonl.zstd');if(await exists(file))return file
  }
}
async function idle(id) { await expect.poll(async () => (await api('sidechat.info',{childId:id})).status,{timeout:120000}).toBe('idle') }
async function open() {
  const response=page.waitForResponse(r=>r.url().endsWith('/side-chat/api/sidechat.start'))
  await main().locator('[data-composer-input]').fill('/side');await main().locator('[data-composer-input]').press('Enter')
  const r=await (await response).json();if(!r.ok)throw Error(r.error?.message)
  const id=r.value.childId;report.created.push(id);await save()
  await expect(side().locator('[data-conversation-content]')).toHaveAttribute('data-conversation-session',id,{timeout:30000})
  await expect(input()).toBeEditable();return id
}
async function close() {
  await side().getByRole('button',{name:'关闭侧边对话',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'关闭此侧边对话？'})
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(input()).toBeEditable()
  await side().getByRole('button',{name:'关闭侧边对话',exact:true}).click()
  await dialog.getByRole('button',{name:'删除并关闭',exact:true}).click()
  await expect(side()).toHaveCount(0,{timeout:30000})
}
async function clean(id) {
  await expect.poll(async () => await sessionFile(id),{timeout:15000}).toBeUndefined()
  await expect.poll(async () => (await api('sidechat.temporary')).childIds.includes(id),{timeout:15000}).toBe(false)
  await expect.poll(async () => page.evaluate(id=>Object.keys(localStorage).filter(key=>key.includes(id)).length,id),{timeout:15000}).toBe(0)
  const cache=join(home,'storages/session_projcache/sessions')
  const cached=await readdir(cache).catch(e=>{if(e.code==='ENOENT')return[];throw e})
  expect(cached.some(name=>name===`${id}.json`||name.startsWith(`${id}.json.bak.`)), 'projection cache residue').toBe(false)
  const workspace=await readFile(join(home,'storages/workspace.json'),'utf8')
  expect(workspace.includes(id), 'workspace registry residue').toBe(false)
  await expect(page.locator(`[data-row-key="session:${id}"]`)).toHaveCount(0)
}
try {
  await page.getByRole('button',{name:'新建会话',exact:true}).first().click()
  await expect(main().locator('[data-conversation-content]')).toHaveAttribute('data-content-phase','hero',{timeout:15000})
  await main().locator('[data-composer-input]').fill('插件验收专用：请记住校验词 HIDDEN_CONTEXT_NOV03。此条消息只回复 PARENT_OK。以后正常回答，不调用工具，除非我明确要求读取本次附件。')
  await main().locator('[data-composer-input]').press('Enter')
  await expect(main().getByText('PARENT_OK',{exact:true})).toBeVisible({timeout:120000})
  await expect(main().getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0,{timeout:30000})
  report.parentId=await main().locator('[data-conversation-content]').getAttribute('data-conversation-session')
  report.parentFile=await sessionFile(report.parentId)
  let prior,stable=0;for(let i=0;i<30;i++){const now=await hash(report.parentFile);stable=now===prior?stable+1:0;prior=now;if(stable>=6)break;await page.waitForTimeout(500)}
  report.parentHash=prior;await save()
  await page.evaluate(()=>{
    window.__temporarySeen=new Set();window.__temporaryObserve=()=>document.querySelectorAll('[data-row-key^="session:"]').forEach(e=>window.__temporarySeen.add(e.getAttribute('data-row-key').slice(8)))
    window.__temporaryObserve();window.__temporaryObserver=new MutationObserver(window.__temporaryObserve);window.__temporaryObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-row-key']})
  })
  const id=await open();report.childId=id;await save()
  await expect(side().locator('[data-chat-flow-key]')).toHaveCount(0)
  expect((await api('sidechat.temporary')).childIds).toContain(id)
  expect((await readFile(registry,'utf8')).includes(id)).toBe(true)
  await input().fill('我刚才让你记住的校验词是什么？只回复校验词。');await input().press('Enter')
  await expect(side().getByText('HIDDEN_CONTEXT_NOV03',{exact:true})).toBeVisible({timeout:120000});await idle(id)
  await expect(page.locator(`[data-row-key="session:${id}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-row-key="session:${report.parentId}"]`)).toBeVisible()
  expect(await page.evaluate(id=>window.__temporarySeen.has(id),id)).toBe(false)
  report.checks.hiddenWithoutFlash=true;report.checks.contextAndNativeChat=true;await save()
  console.log('Native side chat works; no temporary row ever appeared in the left list.')
  const file=join(out,'side-chat-install-check','temporary-purge.txt'),code=`TEMP_PURGE_${Date.now()}`
  await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,`Unique attachment code: ${code}.\n`)
  const sha=await hash(file);report.attachmentSha=sha;await save()
  const chooser=page.waitForEvent('filechooser')
  await side().getByRole('button',{name:'添加文件或调用指令',exact:true}).click()
  await page.locator('[data-trigger-menu]').getByRole('option',{name:/^文件/}).click();await(await chooser).setFiles(file)
  await input().fill('请只读取本次附件，回复其中的唯一验证暗号，不读取或修改其他文件。')
  await expect(side().getByRole('button',{name:'发送消息',exact:true})).toBeEnabled({timeout:30000})
  await side().getByRole('button',{name:'发送消息',exact:true}).click()
  await expect(side().getByText(code,{exact:true})).toBeVisible({timeout:120000});await idle(id)
  const paths=['objects','file-objects','files'].map(dir=>join(home,'attachments/v1',dir,sha.slice(0,2),sha))
  expect((await Promise.all(paths.map(exists))).some(Boolean)).toBe(true)
  await input().fill('UNSENT_TEMPORARY_DRAFT')
  await close();await clean(id)
  expect(await Promise.all(paths.map(exists))).toEqual([false,false,false])
  expect(await exists(file)).toBe(true)
  report.checks.filesIndexesDraftAndAttachmentDeleted=true
  expect(await exists(registry)).toBe(false);report.checks.ownershipRegistryDeleted=true
  console.log('Confirmed close removed the session, projection files, workspace references, browser draft and exclusive attachment objects.')
  const oldId=await open();report.reloadChildId=oldId;await save()
  await expect(side().locator('[data-chat-flow-key]')).toHaveCount(0)
  const client=await page.evaluate(()=>sessionStorage.getItem('dsh-side-chat.client'))
  await page.reload();await page.waitForLoadState('domcontentloaded')
  await expect.poll(async()=>await sessionFile(oldId),{timeout:30000}).toBeUndefined()
  await expect(side().locator('[data-conversation-content]')).toBeVisible({timeout:30000})
  const replacement=await side().getAttribute('data-child-session');expect(replacement).not.toBe(oldId)
  report.created.push(replacement);await save()
  expect(await page.evaluate(()=>sessionStorage.getItem('dsh-side-chat.client'))).toBe(client)
  await clean(oldId)
  await expect(page.locator(`[data-row-key="session:${replacement}"]`)).toHaveCount(0)
  report.checks.reloadReclaimsAbandonedCopy=true
  await close();await clean(replacement)
  expect(await exists(registry)).toBe(false)
  expect(await hash(report.parentFile)).toBe(report.parentHash)
  report.checks.parentUnchanged=true;report.checks.allTemporaryCopiesDeleted=true
  expect(errors).toEqual([]);report.result='passed';await save()
  console.log(JSON.stringify({result:report.result,checks:report.checks}))
}catch(error){report.result='failed';report.error=String(error).split('\n').slice(0,5).join('\n');report.errors=errors;await save();console.error(report.error);process.exitCode=1}
finally{await browser.close()}
