# ShopFlow — Sincronización multi-dispositivo (backend Supabase)

**Meta:** que 2+ dispositivos (iPad + iPhones) usen los MISMOS datos en tiempo real.
"Linkear un dispositivo" = iniciar sesión en la misma cuenta del taller. Eso es el
"código" que Roberto quería. Y eso es lo que hace ShopFlow vendible como multi-dispositivo.

## Arquitectura v1 (rápida, segura, no rompe la app actual)
- **Cuenta del taller** = un usuario de Supabase Auth (email + contraseña).
  En cada dispositivo entras con ese login → quedan linkeados.
- **Los datos** viven en una fila `shops.data` (jsonb) = el mismo DB de ShopFlow que
  hoy vive en `localStorage['sf_v1']`. Mínimo cambio a la app.
- **Realtime**: cuando un dispositivo guarda, los otros reciben el cambio en ~1s.
- **Offline-first**: la app sigue usando localStorage como caché. Sin señal, trabaja
  igual; al volver la señal, sincroniza. (PWA en la calle no se rompe.)
- **Anti-clobber**: al recibir cambios remotos, se hace MERGE por id de
  ordenes/clientes/citas (unión, gana el más reciente), no un reemplazo bruto. Así
  si el iPad crea la orden X y un iPhone crea la Y al mismo tiempo, sobreviven las dos.

### Por qué v1 = blob (y no tablas normalizadas todavía)
La app es un solo DB en memoria. Normalizar cada entidad a su tabla = reescribir los
~4000 renglones de acceso a datos y arriesgar una app que YA funciona con datos reales
+ firmas legales. El blob + realtime + merge da el 95% del valor (linkear devices,
tiempo real, cero pérdida en el caso normal) con riesgo manejable. Normalizar es una
optimización futura (v2) si un taller escala a muchos editores simultáneos.

## Fases
- [x] **F0 — Asegurar los datos reales primero.** Antes de tocar el storage, respaldar
      el iPhone bueno al backup de GitHub actual y verificar (Claude verifica el conteo).
      NO se migra nada hasta que exista una copia segura.
- [ ] **F1 — Proyecto Supabase.** Roberto crea el proyecto (o da acceso) → schema.sql →
      Claude recibe URL + anon key. (Ver "Lo que necesito de Roberto".)
- [ ] **F2 — Capa de sync en la app.** Login del taller, pull al abrir, push al guardar,
      suscripción realtime + merge. Bandera de estado (sincronizado / offline / conflicto).
      Se mantiene el backup a GitHub como red extra. Todo con smoke test.
- [ ] **F3 — Migración.** Subir los datos reales del iPhone bueno a Supabase una sola vez;
      los otros dispositivos entran con el login y bajan lo mismo. Fin del clobbering.
- [ ] **F4 (futuro/venta) — Onboarding de clientes.** "Crear taller" (signup), QR para
      linkear un segundo dispositivo sin teclear, planes.

## Lo que necesito de Roberto (desbloquea F1)
Una de estas dos:

**Opción rápida (Claude hace casi todo):** crear un Personal Access Token en
https://supabase.com/dashboard/account/tokens y pegármelo (o ponerlo en la variable
`SUPABASE_ACCESS_TOKEN`). Con eso el CLI crea el proyecto, corre el schema y saca las
llaves solo.

**Opción manual (más control):**
1. supabase.com → New project → nombre `shopflow`, región East US, guarda la contraseña.
2. SQL Editor → pega `schema.sql` → Run.
3. Project Settings → API → cópiame el **Project URL** y la **anon public key**
   (la anon key es pública por diseño; la protege el RLS de arriba).

## Notas de seguridad
- La `anon key` SÍ puede ir en el HTML del cliente (es pública, la protege RLS).
- La `service_role` key NUNCA va en el cliente ni en el repo.
- El token de GitHub del respaldo viejo sigue por-dispositivo; el backup a GitHub queda
  como red secundaria hasta que Supabase esté probado en la calle.
