# App-estudio-de-pilates

🚀 Podés acceder a través del siguiente enlace :

👉 **[Sistema de reservas y gestión de clases](https://script.google.com/macros/s/AKfycbyfil5hZLJVYJKpIilhb6-hArWerqh0uDXzWVB6_S9FwjBznPOllDnyQF8wNFJOzMcW/exec)**


Aplicación web para centro de Pilates: los alumnos reservan sus clases desde el celular y la administración gestiona clientes, packs, agenda, asistencia y reportes. Funciona sin servidor propio, sobre Google Apps Script, Google Sheets y Google Calendar.

**Estado:** MVP v1.0. Resuelve el ciclo completo → pack → reserva → asistencia → reporte. Los límites conocidos y el plan de evolución están en la documentación.

Desarrollado originalmente para **Cuore Pilates**.

---
## Qué hace

### Portal del cliente
* **Activación de cuenta:** Registro con el correo que dio de alta el centro y gestión de login.
* **Panel de control:** Visualización de clases contratadas, agendadas, restantes, asistidas y packs vigentes con su vencimiento.
* **Agenda semanal:** Consulta de cupos en tiempo real, reserva múltiple y opción de «Repetir en el mes».
* **Cancelación flexible:** Cancelación de reservas futuras con devolución automática de la clase al saldo.

### Portal de administración
* **Pre-alta de clientes:** Registro inicial con pack asignado, fecha de inicio y estado de pago.
* **Gestión de packs:** Asignar, editar, cambiar estado de pago o eliminar packs por cliente.
* **Disponibilidad flexible:** Configuración semanal recurrente o por semana puntual, con generación automática de clases.
* **Tipos de clase:** Clasificación por categoría (Grupal / Personalizada) y definición de cupo por defecto.
* **Agenda global:** Vista general con filtros, asignación manual de turnos y registro de asistencia.
* **Servicios y precios:** Configuración de la categoría de clase que habilita cada pack.
* **Reporte de gestión:** Métricas de ocupación, asistencia, ingresos y detalle por disciplina y por alumno.

---

## Reglas de negocio principales

* Cada reserva descuenta una clase de un pack; el saldo se calcula dinámicamente, no se almacena.
* Un pack vence estrictamente **31 días** después de su fecha de inicio.
* Un pack solo permite reservar clases de las categorías que tiene explícitamente habilitadas.
* El administrador puede asignar una clase fuera de plazo como excepción, pero nunca de una categoría no habilitada.
* Cada reserva crea de forma automática un evento en el Google Calendar del centro.

---

## Cómo mejora el proceso

**Antes:** La gestión era manual: turnos coordinados por mensajería, saldos y pagos en una planilla y cupos controlados de memoria. Esto generaba sobrecupos, saldos mal llevados, vencimientos olvidados, falta de métricas y mucho tiempo de administración.

**Ahora:** Todo el ciclo ocurre dentro del sistema de forma automatizada:

```text
Alta → Activación → Consulta → Reserva → Confirmación → Asistencia → Reporte → Renovación
```

1. **Alta:** La administración carga al cliente con su pack, fecha de inicio y estado de pago.
2. **Activación:** El cliente crea su contraseña y desde ese momento es completamente autónomo.
3. **Consulta:** Ve su saldo, su vencimiento y solo las clases que su pack habilita.
4. **Reserva:** Elige uno o varios turnos. El sistema valida saldo, plazo, categoría, cupo y duplicados, y confirma en el momento. Si no se cumple alguna regla, informa el motivo.
5. **Sincronización:** Cada reserva genera un evento en el Google Calendar del centro.
6. **Cambios:** El cliente puede cancelar y recuperar su clase; la administración puede reasignar o cancelar sin restricciones.
7. **Asistencia:** Se marca de forma simple desde la agenda (Asistió / Faltó).
8. **Seguimiento:** El reporte muestra ocupación, asistencia, ingresos y clases vencidas.
9. **Renovación:** Al acercarse el vencimiento se asigna un nuevo pack y el ciclo vuelve a comenzar.

**Qué se gana:** Reservas sin intermediarios, validación automática de reglas, saldos siempre correctos, una agenda única compartida y métricas en tiempo real.

---

## Arquitectura

```text
Navegador (index.html)
        │  google.script.run
        ▼
Google Apps Script (Code.gs)  ──►  Google Sheets   (9 hojas = base de datos)
   · reglas de negocio         ──►  Google Calendar (un evento por reserva)
   · capa de datos y bloqueo   ──►  PropertiesService (clave del administrador)
```


| Capa | Tecnología |
| :--- | :--- |
| **Frontend** | HTML + JavaScript + Tailwind CSS (CDN), arquitectura Single Page Application (SPA) |
| **Backend** | Google Apps Script (JavaScript V8) |
| **Datos** | Google Sheets |
| **Concurrencia** | LockService (bloqueo para evitar reservas simultáneas) |
| **Variables de entorno** | PropertiesService (clave del administrador e ID del calendario) |

---

## Modelo de datos

El sistema utiliza las siguientes colecciones/hojas interconectadas:
* `Clientes` · `ServiciosPacks` · `Contrataciones` · `TiposClases` · `Disponibilidad` · `SemanasPersonalizadas` · `Clases` · `Reservas` · `Asistencias`

*Nota: El diccionario de datos completo y el diagrama entidad-relación (DER) se encuentran detallados en la carpeta `docs/`.*

---

## Primeros pasos en el portal de administración

1. **Tipos de Clase:** Creá tus disciplinas, asigna su categoría y define su cupo.
2. **Disponibilidad:** Carga los horarios semanales (cada franja se divide en turnos automáticos de 1 hora).
3. **Servicios y precios:** Define tus packs comerciales y qué categorías de clase habilita cada uno.
4. **Clientes → Nueva pre-alta:** Registra a un alumno vinculándolo a su pack inicial. El cliente podrá ingresar a la app usando su correo mediante la opción «Activar mi cuenta» para definir su contraseña.

---

## Estructura del repositorio

```text
.
├── src/
│   ├── Code.gs          # Backend (Apps Script)
│   ├── index.html       # Interfaz de usuario (Cliente y Administración)
│   └── appsscript.json  # Manifiesto de configuración del proyecto
├── docs/                # Documentación técnico-funcional y guías de desarrollo
├── README.md            # Descripción general del proyecto
└── .gitignore           # Archivos excluidos del control de versiones
```

---

## Próximos pasos

El plan avanza por fases: primero se valida el sistema con uso real y después se migrará, antes de sumar funcionalidades grandes.

### Fase 1 · Validación en producción 
- [ ] Recibir feedback de clientes y administración para ajustar reglas y pantallas.
- [ ] Implementar la recuperación de contraseña.
- [ ] Configurar el respaldo automático de la planilla de Google Sheets.
- [ ] Desarrollar el sistema de avisos de próximo vencimiento de packs (para el cliente y la administración).

### Fase 2 · Migración a base de datos relacional y frontend moderno
- [ ] Migrar a una base de datos PostgreSQL administrada, con claves foráneas y restricciones.
- [ ] Reestructurar el backend con las reglas actuales y sesiones seguras con token.
- [ ] Rediseñar el frontend utilizando React.
- [ ] Asegurar la convivencia de ambos sistemas y corte por tandas, usando los casos de prueba como criterio de aceptación.

> 💡 *Nota: Esta fase se realiza antes de las funcionalidades grandes para no construirlas dos veces. Se adelanta si aparece una necesidad que Apps Script no resuelve bien, si crece el número de clientes o si se abre una segunda sede.*

### Fase 3 · Nuevas funcionalidades sobre la plataforma nueva
- [ ] **Asistente virtual (chatbot) inteligente para agendamiento por mensajes y consultas de métricas.**
- [ ] Sistema de lista de espera para clases completas.
- [ ] Envío automatizado de recordatorios por WhatsApp.
- [ ] Creación del perfil de instructor y reportes individuales por instructor.

### Largo plazo
- [ ] Desarrollo de una aplicación móvil nativa o PWA instalable.
- [ ] Soporte multi-sede y gestión de roles con permisos diferenciados.
- [ ] Tablero de métricas avanzadas (retención, renovación, ocupación por franja horaria).

---

## Documentación

La carpeta `docs/` contiene la **documentación técnico-funcional** detallada que incluye: requerimientos, arquitectura, selección tecnológica, DER (Diagrama Entidad-Relación), diccionario de datos, gobierno de datos, especificación de reportes y el flujo de procesos TO-BE.

---

## Contribuir

Las ideas y los reportes de errores son bienvenidos.

---

## Autoría

© 2026 Cordoba Rocio. **Todos los derechos reservados.**







