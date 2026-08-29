export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',

  // SPA: раздаётся самим NestJS, один процесс и один порт. SSR сервису за
  // паролем на одного пользователя не даёт ничего.
  ssr: false,

  devServer: { port: 4291 },

  // в разработке фронт живёт отдельно, поэтому /api проксируется на backend
  nitro: {
    devProxy: {
      '/api': { target: 'http://127.0.0.1:4290/api', changeOrigin: true },
    },
  },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      // локаль важна не только для чтения с экрана: от неё зависит формат,
      // в котором браузер рисует поля дат
      htmlAttrs: { lang: 'ru' },
      title: 'FatOff',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'color-scheme', content: 'light dark' },
        { name: 'description', content: 'Выгрузка аналитики YAZIO в файлы для анализа' },
      ],
      script: [
        {
          // Тема и гамма выставляются до первой отрисовки, иначе страница
          // успевает моргнуть светлой у тех, кто выбрал тёмную.
          innerHTML:
            "try{var r=document.documentElement," +
            "t=localStorage.getItem('fatoff:theme'),p=localStorage.getItem('fatoff:palette');" +
            "if(t==='light'||t==='dark')r.setAttribute('data-theme',t);" +
            "if(p&&/^[a-z]+$/.test(p))r.setAttribute('data-palette',p)}catch(e){}",
          type: 'text/javascript',
          tagPosition: 'head',
        },
      ],
    },
  },

  typescript: { typeCheck: false, strict: true },
})
