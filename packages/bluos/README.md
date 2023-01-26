# BluOS

A BluOS compatible API client library for TypeScript and JavaScript.

## Table of Contents

- [Example](#example)

## Example

```shell
npm install bluos
```

```typescript
import * as BluOS from 'bluos'

BluOS.observePlayback().subscribe((playback) => {
  console.log(playback)
})

await BluOS.play()
```
