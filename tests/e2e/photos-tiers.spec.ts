import {test,expect,type Page} from '@playwright/test'
import {enterEmailCode} from './auth'
async function picture(page:Page,type:'image/png'|'image/jpeg',width=80){
 const data=await page.evaluate(({type,width})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(width*.75);const c=canvas.getContext('2d')!;c.fillStyle='#416b5b';c.fillRect(0,0,canvas.width,canvas.height);return canvas.toDataURL(type).split(',')[1]},{type,width})
 return {name:type==='image/png'?'test-profile.png':'test-camera.jpeg',mimeType:type,buffer:Buffer.from(data,'base64')}
}
test('a nanny can choose PNG, retain it after a network failure, and take a resized JPEG using the camera control',async({page})=>{
 await page.goto('/login');await enterEmailCode(page,'nanny@example.test');await expect(page).toHaveURL('/nanny')
 await page.getByRole('link',{name:'Update my profile photo',exact:true}).click()
 const photo=page.getByRole('form',{name:'Profile photo for Test Nanny'})
 const chooser=page.waitForEvent('filechooser');await photo.getByText('Choose photo',{exact:true}).click();await(await chooser).setFiles(await picture(page,'image/png'))
 await expect(photo.getByRole('img')).toBeVisible();await expect(photo.getByRole('button',{name:'Save photo',exact:true})).toBeEnabled()
 await page.route('**/api/nanny/photo',route=>route.abort())
 await photo.getByRole('button',{name:'Save photo',exact:true}).click();await expect(photo.getByRole('alert')).toBeVisible();await expect(photo.getByText('test-profile.png — ready to save')).toBeVisible()
 await page.unroute('**/api/nanny/photo');await photo.getByRole('button',{name:'Save photo',exact:true}).click();await expect(photo.getByRole('status')).toContainText('Profile photo updated')
 let source=await photo.getByRole('img').getAttribute('src');expect((await page.request.get(source!)).headers()['content-type']).toContain('image/png')
 await expect(photo.getByLabel('Take photo',{exact:true})).toHaveAttribute('capture','user')
 const camera=page.waitForEvent('filechooser');await photo.getByText('Take photo',{exact:true}).click();await(await camera).setFiles(await picture(page,'image/jpeg',2400))
 await expect(photo.getByText('profile-photo.jpg — ready to save')).toBeVisible();await photo.getByRole('button',{name:'Save photo',exact:true}).click();await expect(photo.getByRole('status')).toContainText('Profile photo updated')
 await expect.poll(()=>photo.getByRole('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(1600)
 source=await photo.getByRole('img').getAttribute('src');expect((await page.request.get(source!)).headers()['content-type']).toContain('image/jpeg')
 await page.goto('/nannies/test-nanny');await expect(page.getByRole('img',{name:'Test Nanny',exact:true}).first()).toBeVisible()
 expect((await page.request.post('/api/admin/nannies/33333333-3333-4333-8333-333333333333/photo')).status()).toBe(401)
})
test('an administrator can upload a public nanny photo and a client cannot use either editing endpoint',async({page})=>{
 await page.goto('/login');await enterEmailCode(page,'operator@example.test');await expect(page).toHaveURL('/admin')
 await page.getByRole('navigation',{name:'Operations'}).getByRole('button',{name:/^Nannies/}).click();await page.getByText('Update profile photo',{exact:true}).click()
 const photo=page.getByRole('form',{name:'Profile photo for Test Nanny'});await photo.getByLabel('Choose photo',{exact:true}).setInputFiles(await picture(page,'image/png'))
 await photo.getByRole('button',{name:'Save photo',exact:true}).click();await expect(photo.getByRole('status')).toContainText('Profile photo updated')
 await photo.getByRole('button',{name:'Remove photo',exact:true}).click();await photo.getByRole('button',{name:'Save photo',exact:true}).click();await expect(photo.getByRole('status')).toContainText('Profile photo updated');await expect(photo.getByRole('img')).toHaveCount(0)
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto('/login');await enterEmailCode(page,'family@example.test');await expect(page).toHaveURL('/account')
 expect((await page.request.post('/api/nanny/photo')).status()).toBe(403);expect((await page.request.post('/api/admin/nannies/33333333-3333-4333-8333-333333333333/photo')).status()).toBe(401)
})
test('Bronze search includes higher qualifications and books higher-tier carers at the selected care category',async({page})=>{
 await page.request.get('http://127.0.0.1:4748/__tier-fixtures?enabled=1')
 try{
  await page.goto('/nannies?tier=bronze');await expect(page.getByRole('status')).toHaveText('3 profiles to explore')
  const card=page.locator('.nanny-card').filter({hasText:'Qualified gold'});await expect(card).toContainText('KES 2,200');await expect(card).toContainText('Bronze care')
  await card.getByRole('button',{name:'Request care',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Nanny Tier',{exact:true})).toHaveValue('bronze');await page.keyboard.press('Escape')
  await card.getByRole('link',{name:'Qualified gold',exact:true}).click();await expect(page).toHaveURL(/tier=bronze/);await page.getByRole('button',{name:/^Book Qualified/}).click();await expect(page.getByRole('dialog').getByLabel('Nanny Tier',{exact:true})).toHaveValue('bronze');await page.keyboard.press('Escape')
  await page.goto('/nannies?tier=silver');await expect(page.getByRole('status')).toHaveText('2 profiles to explore')
  await page.goto('/nannies?tier=gold');await expect(page.getByRole('status')).toHaveText('1 profile to explore');await expect(page.locator('.nanny-card')).toContainText('Qualified gold')
 }finally{await page.request.get('http://127.0.0.1:4748/__tier-fixtures?enabled=0')}
})
