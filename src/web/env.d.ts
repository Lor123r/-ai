/**
 * 构建期注入的常量。
 *
 * 浏览器宿主没有 `app.getVersion()` 可问，版本号只能在打包时从 package.json 读出来
 * 塞进产物（见 vite.web.config.ts 的 define）。声明成 `declare const` 而不是挂到
 * `window` 上：它是编译期替换的字面量，不是运行时属性，挂到 window 上会让人以为
 * 可以在控制台里改。
 */
declare const __APP_VERSION__: string
