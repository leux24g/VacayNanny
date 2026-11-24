import {expect,test} from '@playwright/test'

test('decorative photos stay still and have no Pause control',async({page})=>{
 await page.clock.install()
 for(const [route,label] of [['/','Family holiday moments'],['/become-a-nanny','Everyday childcare moments']]){
  await page.goto(route)
  const photo=page.getByRole('group',{name:label})
  await expect(photo.locator('img')).toHaveCount(1)
  await photo.locator('img').evaluate(image=>(image as HTMLImageElement).decode())
  const source=await photo.locator('img').getAttribute('src')
  await page.clock.fastForward(30000)
  await expect(photo.locator('img')).toHaveAttribute('src',source!)
  await expect(photo.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button',{name:/pause|resume.*slideshow/i})).toHaveCount(0)
 }
})
test('a missing decorative photo uses the next available source without introducing motion controls',async({page})=>{
 await page.route(url=>url.pathname==='/_next/image' && url.searchParams.get('url')==='/images/slides/family-beach.webp',route=>route.abort())
 await page.goto('/')
 const photo=page.getByRole('group',{name:'Family holiday moments'})
 await expect(photo.locator('img')).toHaveAttribute('src',/family-garden/)
 await photo.locator('img').evaluate(image=>(image as HTMLImageElement).decode())
 await expect(photo.getByRole('button')).toHaveCount(0)
})
