# Changelog

## [2026-09-26] — v1.0.0

### Added
- Gráfico interativo com zoom, pan e tooltips (Canvas)
- Seção El Niño/La Niña com mapa NOAA CPC
- Matriz de risco região × tipo de desastre
- Alertas ativos com notificações nativas
- Checklist de preparação com persistência local
- Suporte a PWA (manifest.json, service worker)

### Accessibility
- Tabela de dados do gráfico para leitores de tela (sr-only)
- Rótulos ARIA em elementos interativos

### Performance
- Cache ETag para requisições HTTP (304 Not Modified)
- Persistência de dados no localStorage com prefixo gm_

### Security
- Escape de HTML para prevenir XSS em mensagens de alerta
- Sanitização de dados externos antes da renderização

### Infrastructure
- Error boundary para renderização segura de componentes
- Testes unitários para validação, alertas e riscos
