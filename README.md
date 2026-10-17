# CukaBasement

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Cài đặt

**Yêu cầu:** Node.js (theo `engines` trong `package.json`), MongoDB đang chạy với database `CukaDB`, MinIO đang chạy local, và ffmpeg có trong `PATH`.

**CORS cho MinIO:** cho phép origin của `APP_URL` (mặc định `http://localhost:5173`) thực hiện POST, để trình duyệt upload trực tiếp lên MinIO.

```sh
cp .env.example .env        # rồi chỉnh các giá trị cho phù hợp
npm install
npm run setup               # tạo index MongoDB, bucket MinIO và settings (chạy lại an toàn)
npm run create-admin -- --email <email> --password <mật khẩu> --username <tên>
npm run dev                 # chạy song song shared, api, worker, web
```

Các lệnh khác: `npm run build`, `npm test`, `npm run type-check`.
