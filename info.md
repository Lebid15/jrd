# طريقة الرفع والنشر (Deployment)

## الخلاصة السريعة
المشروع موصول بـ **Railway** عبر **GitHub** (auto-deploy من فرع `main`).
كل ما عليّ فعله:

```powershell
git add <الملفات أو .>
git commit -m "رسالة واضحة"
git push
```

Railway يلتقط الـ push تلقائياً ويبدأ build/deploy خلال ثوانٍ.

## روابط مهمة
- **مستودع GitHub**: https://github.com/Lebid15/jrd
- **Railway Project (المراقبة)**:
  https://railway.com/project/fec70dd5-0c5d-4149-855f-ffac4cc2c932/service/31f32c5e-0f55-42e9-b666-45f81931f38e?environmentId=a72c2319-811a-4231-964f-770506175bcf
- **الفرع المنشور**: `main`

## توزيع المهام (اتفاق ثابت بيننا)
- **أنا (Copilot)**: أعدّل الكود → `git add` → `git commit` → `git push`.
- **أنت**: تراقب نتائج البناء والتشغيل في صفحة Railway أعلاه، وتُبلغني إذا فشل البناء أو ظهرت أخطاء runtime.

## ملاحظات
- لا حاجة لاستخدام `railway up` أو CLI — النشر يتم بالكامل عبر دفع git.
- ملف `railway.toml` و `Dockerfile` موجودان في جذر المستودع ويضبطان البناء.
- بعد كل push انتظر دقيقة ~ ثم حدّث صفحة Railway لرؤية اللوج.

## أوامر مساعدة سريعة
```powershell
git status                    # ماذا تغير
git log --oneline -10         # آخر 10 commits
git diff <file>               # مراجعة قبل commit
```
