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
- Serverlər (SSH): soldakı server ikonu "Serverlər" tabını açır. Serverlər müştərilərə görə qruplaşır, hər serverin mühiti (prod, preprod, dev) göstərilir. Terminal grid-də adi panel kimi açılır, eyni serverə bir neçə terminal açmaq olar.

## SSH

- Giriş üsulları: parol, SSH açarı (parollu açar da), Windows ssh-agent, iki addımlı kod. Jump host (bastion) üzərindən də qoşulmaq olur.
- Parollar Windows-un öz şifrələməsi ilə `%APPDATA%\AgentGrid\secrets.json` faylında saxlanır. Server siyahısı (`hosts.json`) parolsuzdur.
- İlk qoşulmada serverin barmaq izi soruşulur. İz sonradan dəyişsə, proqram qoşulmur və xəbərdarlıq edir.
- Server panelinin çərçivəsi mühitə görə rənglənir: prod qırmızı, preprod sarı, dev mavi. Belə panel adi terminaldan və Claude-dan dərhal seçilir.
- Prod serverə qoşulmazdan əvvəl təsdiq soruşulur. "Hamısını başlat" prod serverlərə heç vaxt qoşulmur.
- Siyahını komanda yoldaşları ilə paylaşmaq olar: Serverlər tabında "⋯" düyməsinə basıb "İxrac et" seçirsiniz, alınan faylı onlar "İdxal et" ilə götürürlər. Parollar fayla düşmür.

### SFTP

- SFTP paneli 4 yerdən açılır: server sətrindəki qovluq düyməsi, sağ klik menyusu ("SFTP aç", "Terminal + SFTP yan-yana"), SSH terminalının başlığındakı "SFTP" düyməsi və Ctrl+K.
- Həmin serverin terminalı açıqdırsa, SFTP onun bağlantısından istifadə edir. Parolu ikinci dəfə yazmırsınız.
- Solda bu kompüter, sağda server görünür. Faylı və ya qovluğu o biri tərəfə sürükləmək, Explorer-dən atmaq, "Yüklə" və "Endir" düymələri, iki dəfə klik ilə köçürmək olar.
- Köçürmə növbəsində sürət və qalan vaxt görünür, köçürməni ləğv etmək olur. Fayl tam köçməyincə öz adını almır, ona görə yarımçıq fayl qalmır.
- Serverdə yeni qovluq yaratmaq (+), ad dəyişmək (F2), silmək (Del, təsdiqlə) və icazələri dəyişmək olur.
- Klaviatura: SFTP paneli açılanda ↓ basın, "Bu kompüter" siyahısına düşürsünüz. Fayllar arasında ↑ ↓ ilə keçilir, Enter qovluğa girir, Backspace bir qovluq yuxarı çıxır. Qovluğa girəndə və geri çıxanda klaviatura siyahıda qalır, yenidən klik etmək lazım deyil. Ünvan sətrində ↓ basanda da siyahıya keçirsiniz.
- Siyahıda hərf yazanda həmin hərflərlə başlayan fayl seçilir (yalnız açıq qovluqda): `c` → C, `ca` → CA, `cab` → CAB. Bir saniyə yazmasanız axtarış sıfırlanır. Eyni hərfi təkrar basanda həmin hərflə başlayan fayllar arasında növbə ilə keçir.
- **Redaktorda aç** (sağ klik): fayl kompüterə endirilir və VS Code-da açılır, VS Code yoxdursa Notepad-da. Hər dəfə saxlayanda fayl serverə özü yüklənir. Fayl heç vaxt işə salınmır, yalnız redaktorda açılır.
- Bağlantı qopsa, köçürmənin yanında **Davam et** düyməsi çıxır. Köçürmə qaldığı yerdən davam edir, başdan başlamır.
- **Terminalın qovluğunu izlə** (zəncir düyməsi): terminalda `cd` edəndə SFTP də həmin qovluğa keçir. Bunun üçün serverdəki shell qovluğu bildirməlidir. bash üçün `~/.bashrc`-yə bu sətri əlavə edin:

  ```
  PROMPT_COMMAND='printf "\033]7;file://%s%s\033\\" "$HOSTNAME" "$PWD"'
  ```

SSH işini ayrıca kiçik proqram, `agentgrid-ssh.exe` görür. O, Go dilində yazılıb (`native/ssh-helper`) və yalnız ilk qoşulmada işə düşür.

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

Node.js və Go (1.27+) lazımdır.

```
npm install
npm run build:ssh
npm run dev
npm test
npm run test:ssh
npm run dist
```

`npm run build:ssh` SSH köməkçisini `resources/bin/agentgrid-ssh.exe` faylına yığır. `npm run dist` bunu özü edir.

`npm run dist` quraşdırıcını `release/` qovluğuna yığır.

Stack: Electron, React, TypeScript, xterm.js, node-pty.
