# AgentGrid

Bir pəncərədə bir neçə real terminal. Əsasən Claude Code, Codex və Gemini CLI kimi AI agentləri üçündür. Yalnız Windows.

## Yükləmə

Son versiya: **[Releases səhifəsi](https://github.com/rebbinn/agentgrid/releases/latest)**

Birbaşa quraşdırıcı: https://github.com/rebbinn/agentgrid/releases/latest/download/AgentGrid-Setup.exe

1. `AgentGrid-Setup.exe` faylını işlədin. Admin hüququ lazım deyil, proqram öz istifadəçi qovluğuna qurulur.
2. Windows mavi "Windows kompüterinizi qorudu" pəncərəsi göstərə bilər, çünki quraşdırıcının rəqəmsal imzası yoxdur. **Daha ətraflı**, sonra **Yenə də işlət** basın.
3. Desktop və Start menyusunda AgentGrid yarlığı yaranır. Taskbar-a bağlamaq üçün açıq proqramın ikonuna sağ klik edin.

Claude düyməsinin işləməsi üçün Claude Code kompüterdə quraşdırılmış olmalıdır (`claude` komandası işləməlidir). Codex və Gemini də eynilə: tapılmasalar, proqram "tapılmadı" yazır.

## Nələr var

- Avtomatik böyüyən terminal şəbəkəsi, düzülüş seçimi, ayırıcıları siçanla və ya klaviaturla çəkmək, fokus rejimi.
- Shell seçimi: CMD, PowerShell, Git Bash, WSL.
- Soldakı Claude düyməsi: hər basanda yeni terminal açılır və içində `claude` başlayır.
- Claude söhbətləri siyahısı (`claude --resume` kimi): söhbətə klik edəndə həmin söhbət yeni terminalda açılır.
- İş sahələri: hər layihə üçün ayrı terminal qrupu. Başqa iş sahəsinə keçəndə köhnəsindəki terminallar dayanmır.
- Ctrl+K əmr paleti, qısayollar, komanda şablonları.
- Göndərmə paneli: AI-nin verdiyi komandanı yeni tab açmadan mövcud terminala göndərir. Komanda yalnız "Göndər" basanda işləyir.
- Düzülüş, ayarlar və iş sahələri yadda qalır. Terminalın çıxışı və yazdıqlarınız heç vaxt yazılmır.

Proqram bağlananda terminal prosesləri dayanır. Yenidən açanda terminallar "Gözləyir" vəziyyətində gəlir və özbaşına başlamır.

## Qısayollar

| Qısayol | Əməl |
| --- | --- |
| Ctrl+K | Əmr paleti |
| Ctrl+Shift+T | Yeni terminal |
| Ctrl+Shift+L | Yeni Claude |
| Ctrl+Shift+W | Terminalı bağla |
| Ctrl+Shift+M | Fokus rejimi |
| Ctrl+Shift+B | Yan panel |
| Ctrl+Shift+H | Söhbətlər |
| Ctrl+Shift+S | Göndərmə paneli |
| Ctrl+, | Ayarlar |
| Ctrl+1…9 | N-ci terminala keç |
| Ctrl+PageUp / PageDown | Əvvəlki / növbəti terminal |

Terminalın öz düymələri (Ctrl+C, Ctrl+D, Ctrl+R və s.) toxunulmazdır. Yeganə istisna Ctrl+K-dır.

## Yığmaq

Node.js lazımdır.

```
npm install
npm run dev
npm test
npm run dist
```

`npm run dist` quraşdırıcını `release/` qovluğuna yığır.

Stack: Electron, React, TypeScript, xterm.js, node-pty.
