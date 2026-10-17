import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { useAuth } from './stores/auth'
import './styles.css'

const pinia = createPinia()
createApp(App).use(pinia).use(router).use(i18n).mount('#app')
// Restore the session from the refresh cookie once at start; `ready` flips when it settles.
void useAuth(pinia).init()
