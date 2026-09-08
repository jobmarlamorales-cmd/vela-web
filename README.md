# VELA — Aplicación web

Interfaz web de VELA. Proyecto completamente separado de `vela-backend` y de
`vela-connect`: no comparte archivos ni lógica con ninguno de los dos, solo
le habla al backend por HTTP (fetch), igual que le hablaría cualquier otro
cliente.

No usa ningún framework ni paso de compilación: es HTML + CSS + JavaScript
simple, para que sea fácil de revisar.

## Cómo correrla

Con `vela-backend` corriendo en `http://localhost:4000`:

```
node server.js       # sirve la app en http://localhost:5173
```

Si el backend corre en otra dirección, se puede indicar antes de cargar
`app.js` definiendo `window.VELA_API_BASE` en `index.html`.

## Estructura

```
index.html   estructura de la app (pantalla de acceso + las 8 secciones)
styles.css   sistema visual (el mismo de la maqueta que ya se revisó)
app.js       toda la lógica: llama al backend real, no inventa datos
server.js    servidor estático mínimo, sin dependencias
```

