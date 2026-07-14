-- 国内精品肉铺：商品多图升级脚本
-- 在 Supabase Dashboard → SQL Editor 中运行一次。

begin;

alter table public.products
  add column if not exists image_urls text[] not null default '{}'::text[];

-- 把旧版单张主图迁移到多图数组，旧商品无需重新上传。
update public.products
set image_urls = array[image_url]
where image_url is not null
  and btrim(image_url) <> ''
  and coalesce(cardinality(image_urls), 0) = 0;

commit;

-- 让 Supabase REST API 立即重新读取表结构。
notify pgrst, 'reload schema';

-- 验证结果：每个商品应出现 image_urls 字段。
select id, name, image_url, image_urls
from public.products
order by sort_order, id;