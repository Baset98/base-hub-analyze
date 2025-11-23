const express = require('express');
const app = express();

app.use(express.static('public'));

app.listen(3000, 'localhost', () => {
    console.log('✅ سرور با موفقیت راه اندازی شد!');
    console.log('🌐 به آدرس زیر بروید:');
    console.log('   http://localhost:3000');
    console.log('\nبرای متوقف کردن سرور، Ctrl+C را بزنید.');
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('❌ پورت 3000 در حال استفاده است!');
        console.error('لطفاً برنامه دیگری که از این پورت استفاده می‌کند را ببندید.');
    } else {
        console.error('❌ خطا در راه اندازی سرور:', err.message);
    }
    process.exit(1);
});



