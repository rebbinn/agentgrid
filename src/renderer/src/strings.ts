import type { TerminalErrorCode } from '@shared/ipc'
import type { SshErrorCode } from '@shared/ssh'

export const strings = {
  appName: 'AgentGrid',
  tagline: 'Bir iş sahəsində bir neçə AI agent terminalı',
  layout: {
    presets: {
      auto: 'Avtomatik',
      single: 'Tək terminal',
      columns: 'İki sütun',
      rows: 'İki sətir',
      'grid-2x2': '2 × 2',
      'grid-3x2': '3 × 2',
      'grid-2x3': '2 × 3'
    },
    hints: {
      auto: 'Panel sayına görə böyüyür',
      single: '1 sütun · 1 sətir',
      columns: '2 sütun · 1 sətir',
      rows: '1 sütun · 2 sətir',
      'grid-2x2': '2 sütun · 2 sətir',
      'grid-3x2': '3 sütun · 2 sətir',
      'grid-2x3': '2 sütun · 3 sətir'
    },
    focus: 'Fokus rejimi',
    focusHint: 'Aktiv terminal bütün sahəni tutur',
    overflow: 'Seçilmiş düzülüş panel sayına çatmır, avtomatik böyüdüldü',
    columnSplitter: (index: number) => `Sütun ayırıcısı ${index}`,
    rowSplitter: (index: number) => `Sətir ayırıcısı ${index}`,
    tabs: 'Terminallar',
    emptySlot: 'Boş yuva'
  },
  pane: {
    maximize: 'Böyüt',
    restore: 'Bərpa et',
    menu: 'Panel əməliyyatları',
    rename: 'Adı dəyişdir',
    renameLabel: 'Terminalın adı',
    moveEarlier: 'Əvvələ çək',
    moveLater: 'Sonraya çək',
    fontLarger: 'Şrifti böyüt',
    fontSmaller: 'Şrifti kiçilt',
    fontReset: 'Şrift ölçüsünü sıfırla',
    fontSize: (size: number) => `Şrift: ${size}`
  },
  header: {
    openProject: 'Layihə qovluğu seç',
    noProject: 'Layihə seçilməyib',
    layout: 'Düzülüş',
    newTerminal: 'Yeni terminal',
    chooseShell: 'Başqa shell ilə aç'
  },
  rail: {
    claude: 'Claude (yeni terminal)',
    claudeTip: 'Claude — yeni CMD-də işə sal',
    toggleSidebar: 'Yan paneli göstər / gizlət'
  },
  workspace: {
    defaultName: 'Əsas',
    namePrefix: 'İş sahəsi',
    switcherLabel: 'İş sahəsi',
    listTitle: 'İş sahələri',
    newItem: 'Yeni iş sahəsi…',
    renameItem: 'Adı dəyişdir…',
    deleteItem: 'Bu iş sahəsini sil…',
    paneCount: (count: number) => `${count} terminal`,
    runningCount: (count: number) => `${count} işləyir`,
    noProject: 'layihə yoxdur',
    loading: 'Yüklənir…',
    dialogs: {
      createTitle: 'Yeni iş sahəsi',
      renameTitle: 'İş sahəsinin adı',
      nameLabel: 'Ad',
      create: 'Yarat',
      save: 'Yadda saxla',
      cancel: 'Ləğv et',
      nameRequired: 'Ad boş ola bilməz.',
      deleteTitle: 'İş sahəsi silinsin?',
      deleteText: (name: string) =>
        `"${name}" iş sahəsi və onun saxlanmış terminal düzülüşü silinəcək. Layihə qovluğunuza toxunulmayacaq.`,
      deleteRunning: (count: number) => ` İçindəki ${count} işləyən terminal dayandırılacaq.`,
      delete: 'Sil'
    }
  },
  restore: {
    bannerLabel: 'Bərpa olunmuş terminallar',
    banner: (count: number) =>
      `${count} terminal saxlanmış konfiqurasiyadan bərpa olundu. Proseslər proqram bağlananda dayanıb, ona görə gözləyirlər.`,
    startAll: 'Hamısını başlat',
    autoStart: 'Həmişə avtomatik başlat',
    autoStartHint: 'Bu iş sahəsi açılanda saxlanmış terminallar özləri başlayacaq',
    overlayTitle: 'Saxlanmış terminal',
    overlayText: (shell: string, folder: string) =>
      `${shell} · ${folder}. Proses işləmir, başlatmaq üçün düyməyə basın.`,
    overlayCommand: (command: string) => `Başlayanda bu komanda işə düşəcək: ${command}`,
    start: 'Başlat'
  },
  notices: {
    reset: (file: string) =>
      file
        ? `Ayarlar faylı zədələnmişdi, oxuna bilmədi. Köhnə fayl "${file}" adı ilə saxlanıb, proqram boş ayarlarla başladı.`
        : 'Ayarlar oxuna bilmədi, proqram boş ayarlarla başladı.',
    recovered: (file: string) =>
      `Ayarlar faylı zədələnmişdi, son yaxşı nüsxədən bərpa olundu. Zədəli fayl "${file}" adı ilə saxlanıb.`,
    newer: (file: string) =>
      `Ayarlar faylı bu proqramdan daha yeni versiyaya aiddir. Ona toxunmadım ("${file}" adı ilə saxlanıb), boş ayarlarla başladım.`,
    dropped: (count: number) => `${count} iş sahəsi oxuna bilmədi və atlandı.`,
    droppedPresets: (count: number) => `${count} şablon oxuna bilmədi və atlandı.`,
    hostsUnreadable: (file: string) =>
      `Server siyahısı faylı oxuna bilmədi. Köhnə fayl "${file}" adı ilə saxlanıb, siyahı boş başladı.`,
    droppedHosts: (count: number) => `${count} server oxuna bilmədi və atlandı.`
  },
  palette: {
    open: 'Əmrlər',
    label: 'Əmr paleti',
    placeholder: 'Əmr axtarın…',
    listLabel: 'Əmrlər',
    empty: 'Uyğun əmr tapılmadı.',
    hint: '↑ ↓ seçmək · Enter icra etmək · Esc bağlamaq'
  },
  commands: {
    groups: {
      terminal: 'Terminal',
      agent: 'Agent',
      preset: 'Şablon',
      layout: 'Düzülüş',
      workspace: 'İş sahəsi',
      goto: 'Terminala keç',
      chat: 'Söhbət',
      servers: 'Server',
      view: 'Görünüş',
      settings: 'Ayarlar'
    },
    newTerminal: 'Yeni terminal',
    newTerminalIn: (label: string) => `Yeni terminal: ${label}`,
    closeActive: 'Aktiv terminalı bağla',
    restartActive: 'Aktiv terminalı yenidən başlat',
    clearActive: 'Aktiv terminalın ekranını təmizlə',
    renameActive: 'Aktiv terminalın adını dəyiş',
    maximize: 'Aktiv terminalı böyüt (fokus rejimi)',
    restore: 'Fokus rejimindən çıx',
    fontUp: 'Aktiv terminalın şriftini böyüt',
    fontDown: 'Aktiv terminalın şriftini kiçilt',
    fontReset: 'Aktiv terminalın şrift ölçüsünü sıfırla',
    send: 'Komandanı terminala göndər…',
    launchAgent: (label: string, installed: boolean | null) =>
      installed === false ? `${label} başlat (tapılmadı)` : `${label} başlat`,
    chooseAgent: 'Agenti seçimlə başlat…',
    preset: (name: string) => `Şablon: ${name}`,
    newPreset: 'Yeni şablon yarat…',
    layout: (label: string) => `Düzülüş: ${label}`,
    focusMode: 'Fokus rejimi',
    switchWorkspace: (name: string) => `İş sahəsinə keç: ${name}`,
    newWorkspace: 'Yeni iş sahəsi…',
    renameWorkspace: 'İş sahəsinin adını dəyiş…',
    deleteWorkspace: 'İş sahəsini sil…',
    pickProject: 'Layihə qovluğu seç…',
    goto: (title: string) => `Terminala keç: ${title}`,
    openChat: (title: string) => `Söhbəti aç: ${title}`,
    toggleChats: 'Söhbətlər tabını aç / bağla',
    toggleSidebar: 'Yan paneli göstər / gizlət',
    openSettings: 'Ayarları aç',
    newServer: 'Yeni server…',
    toggleServers: 'Serverlər tabını aç / bağla',
    connectServer: (name: string, group: string) =>
      group ? `Serverə qoşul: ${name} (${group})` : `Serverə qoşul: ${name}`,
    openSftp: (name: string, group: string) => (group ? `SFTP: ${name} (${group})` : `SFTP: ${name}`)
  },
  send: {
    title: 'Komandanı terminala göndər',
    targetLabel: 'Hədəf terminal',
    textLabel: 'Göndəriləcək mətn',
    placeholder: 'AI-nin verdiyi komandanı bura yapışdırın…',
    execute: 'Göndərəndən sonra Enter bas (icra et)',
    send: 'Göndər',
    close: 'Bağla',
    lines: (count: number) => `${count} sətir`,
    hint: 'Mətn yalnız "Göndər" düyməsinə basanda seçilmiş terminala yazılır. Ctrl+Enter də göndərir.',
    noTerminal: 'Əvvəlcə bir terminal açın.',
    noRunning: 'İşləyən terminal yoxdur. Göndərmək üçün bir terminal başladın.',
    notRunning: 'Hədəf terminal işləmir.',
    sent: (title: string) => `Göndərildi: ${title}`,
    toggle: 'Komandanı terminala göndər'
  },
  settings: {
    title: 'Ayarlar',
    close: 'Bağla',
    terminalSection: 'Terminal',
    fontSize: 'Yeni terminalların şrift ölçüsü',
    fontHint: 'Artıq açıq terminallara təsir etmir, yalnız yeni açılanlara.',
    fontIncrease: 'Şrifti böyüt',
    fontDecrease: 'Şrifti kiçilt',
    applyToAll: 'Bütün açıq terminallara tətbiq et',
    defaultShell: 'Standart shell',
    autoShell: 'Avtomatik (CMD, yoxdursa ilk tapılan)',
    shortcutsSection: 'Qısayollar',
    shortcutsHint:
      'Qısayollar terminalın öz düymələri (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+R və s.) ilə toqquşmasın deyə seçilib. Yeganə istisna Ctrl+K-dır: o, əmr paletini açır, ona görə bash-in "sətrin sonunu sil" düyməsi bu proqramda işləmir.',
    terminalKeysTitle: 'Terminalın içində',
    aboutSection: 'Haqqında',
    about: (version: string) => `AgentGrid ${version}`,
    local: 'Bütün ayarlar yalnız bu kompüterdə saxlanır, heç yerə göndərilmir.'
  },
  shortcutLabels: {
    palette: 'Əmr paleti',
    newTerminal: 'Yeni terminal',
    newClaude: 'Yeni Claude',
    closePane: 'Aktiv terminalı bağla',
    toggleFocus: 'Fokus rejimi (böyüt / bərpa et)',
    toggleSidebar: 'Yan paneli göstər / gizlət',
    toggleSessions: 'Söhbətlər tabını aç / bağla',
    toggleSend: 'Komandanı terminala göndər',
    openSettings: 'Ayarlar',
    nextPane: 'Növbəti terminal',
    previousPane: 'Əvvəlki terminal',
    focusPane: (index: number) => `${index}-ci terminala keç`
  },
  terminalKeys: [
    { keys: 'Ctrl+C', label: 'Seçim varsa kopyalayır, yoxdursa proqramı dayandırır' },
    { keys: 'Ctrl+Shift+C', label: 'Seçilmiş mətni kopyala' },
    { keys: 'Ctrl+V', label: 'Yapışdır' },
    { keys: 'Sağ klik', label: 'Seçim varsa kopyala, yoxdursa yapışdır' },
    { keys: 'Ctrl + / Ctrl −', label: 'Şrifti böyüt / kiçilt' },
    { keys: 'Ctrl+0', label: 'Şrift ölçüsünü sıfırla' }
  ],
  presets: {
    title: 'Şablonlar',
    builtIn: 'Hazır agentlər',
    mine: 'Mənim şablonlarım',
    new: 'Yeni şablon',
    start: 'Başlat',
    startWith: 'Seçimlə başlat…',
    edit: 'Düzəliş et',
    delete: 'Sil',
    notInstalled: 'tapılmadı',
    empty: 'Hələ şablon yoxdur.',
    plainTerminal: 'adi terminal',
    kindAgent: 'agent',
    startLabel: (name: string) => `${name} şablonunu başlat`,
    editLabel: (name: string) => `${name} şablonunu düzəlt`,
    deleteLabel: (name: string) => `${name} şablonunu sil`,
    editor: {
      createTitle: 'Yeni şablon',
      editTitle: 'Şablonu düzəlt',
      name: 'Ad',
      kind: 'Növ',
      kindCommand: 'Adi komanda',
      kindAgent: 'Agent proqramı (quraşdırılıb-quraşdırılmadığı yoxlanır)',
      command: 'Komanda',
      commandHint: 'Boş qoysanız, yalnız boş terminal açılır.',
      shell: 'Shell',
      shellAuto: 'Standart shell',
      folder: 'Qovluq',
      folderWorkspace: 'İş sahəsinin layihə qovluğu',
      folderFixed: 'Sabit qovluq',
      choose: 'Seç…',
      noFolder: 'Qovluq seçilməyib',
      safety: 'Yadda saxlamaq komandanı işə salmır. Komanda yalnız "Başlat" düyməsinə basanda icra olunur.',
      save: 'Yadda saxla',
      cancel: 'Ləğv et',
      nameRequired: 'Ad boş ola bilməz.',
      commandRequired: 'Agent şablonu üçün komanda lazımdır.',
      commandInvalid: 'Komanda bir sətir olmalıdır (sətir keçidi və idarəedici simvollar olmaz).',
      folderRequired: 'Sabit qovluğu seçin və ya "iş sahəsinin layihə qovluğu"nu işarələyin.',
      tooMany: 'Şablon limiti dolub (100).',
      saved: (name: string) => `"${name}" şablonu yadda saxlandı. İşə salınmadı.`
    },
    deleteDialog: {
      title: 'Şablon silinsin?',
      text: (name: string) => `"${name}" şablonu silinəcək. Bu terminallara toxunmayacaq.`,
      confirm: 'Sil'
    },
    launchDialog: {
      title: 'Seçimlə başlat',
      program: 'Proqram',
      plain: 'Adi terminal',
      shell: 'Shell',
      folder: 'Qovluq',
      folderProject: 'Hazırkı layihə qovluğu',
      folderChosen: 'Seçilmiş qovluq',
      start: 'Başlat',
      cancel: 'Ləğv et',
      notInstalledNote: 'Bu proqram PATH-də tapılmadı. Başlatsanız terminalda xəta görəcəksiniz.'
    }
  },
  time: {
    now: 'indicə',
    minutes: (count: number) => `${count} dəq əvvəl`,
    hours: (count: number) => `${count} saat əvvəl`,
    yesterday: 'dünən',
    days: (count: number) => `${count} gün əvvəl`
  },
  sessions: {
    tab: 'Söhbətlər',
    tabClose: 'Söhbətlər tabını bağla',
    tablist: 'Yan panelin bölmələri',
    railTip: 'Claude söhbətləri',
    scopeLabel: 'Hansı söhbətlər göstərilsin',
    scopeProject: 'Bu layihə',
    scopeAll: 'Bütün layihələr',
    searchLabel: 'Söhbətlərdə axtar',
    searchPlaceholder: 'Axtar…',
    refresh: 'Siyahını yenilə',
    loading: 'Yüklənir…',
    loadFailed: 'Söhbətlər oxuna bilmədi.',
    retry: 'Yenidən cəhd et',
    emptyProject: 'Bu layihədə köhnə Claude söhbəti yoxdur.',
    emptyAll: 'Heç bir Claude söhbəti tapılmadı.',
    emptySearch: 'Axtarışa uyğun söhbət yoxdur.',
    hint: 'Ctrl+A: bütün layihələrə keç',
    listLabel: 'Claude söhbətləri',
    open: (title: string) => `Söhbəti aç: ${title}`,
    alreadyOpen: 'Bu söhbət artıq açıqdır, ona keçdim.',
    missing: 'Bu söhbət tapılmadı, silinmiş ola bilər.',
    paneTitle: (title: string) => `Claude · ${title}`,
    count: (count: number) => `${count} söhbət`
  },
  sidebar: {
    tabProjects: 'Layihə',
    project: 'Layihə',
    recent: 'Son açılanlar',
    noRecent: 'Hələ başqa layihə açılmayıb.'
  },
  empty: {
    noProjectText:
      'Layihə seçilməyib, terminallar ev qovluğunuzda açılacaq. İstəsəniz layihə qovluğunu seçin.',
    noTerminalsTitle: 'Hələ terminal yoxdur',
    noTerminalsText: 'Solda Claude düyməsinə basanda yeni CMD açılıb içində Claude işə düşəcək.',
    pickProject: 'Layihə qovluğu seç',
    startClaude: 'Claude başlat',
    plainTerminal: 'Boş terminal aç'
  },
  status: {
    terminals: (count: number) => `${count} terminal`,
    ready: 'Hazır',
    active: (title: string) => `Aktiv: ${title}`,
    grid: (columns: number, rows: number) => `${columns} × ${rows}`,
    focus: 'Fokus'
  },
  terminal: {
    launchFailed: 'Terminal açmaq alınmadı',
    noShell: 'Bu kompüterdə heç bir shell tapılmadı',
    shellGone: (id: string) => `Seçilmiş shell bu kompüterdə tapılmadı: ${id}`,
    states: {
      idle: 'Gözləyir',
      starting: 'Başlayır',
      running: 'İşləyir',
      exited: 'Bitib',
      error: 'Xəta'
    },
    exitedBar: (code: number) => `Proses bitdi (çıxış kodu ${code})`,
    restart: 'Yenidən başlat',
    retry: 'Yenidən cəhd et',
    clear: 'Ekranı təmizlə',
    close: 'Bağla',
    errorTitle: 'Terminal başlamadı',
    paneLabel: (title: string) => `Terminal: ${title}`,
    errorText: (code: TerminalErrorCode, detail: string): string => {
      switch (code) {
        case 'cwd-missing':
          return `Layihə qovluğu tapılmadı: ${detail}`
        case 'shell-missing':
          return `Seçilmiş shell tapılmadı: ${detail}`
        case 'agent-missing':
          return `"${detail}" proqramı quraşdırılmayıb və ya PATH-də yoxdur. Quraşdırdıqdan sonra yenidən cəhd edin.`
        case 'duplicate-id':
          return 'Bu terminal artıq açılıb.'
        case 'spawn-failed':
          return `Proses işə düşmədi: ${detail}`
      }
    }
  },
  servers: {
    tab: 'Serverlər',
    tabClose: 'Serverlər tabını bağla',
    railTip: 'Serverlər (SSH)',
    searchLabel: 'Serverlərdə axtar',
    searchPlaceholder: 'Ad, müştəri və ya IP…',
    add: 'Yeni server',
    menu: 'Siyahı əməliyyatları',
    exportAll: 'Siyahını fayla ixrac et (parolsuz)…',
    importFile: 'Fayldan idxal et…',
    ungrouped: 'Qrupsuz',
    groupToggle: (name: string, open: boolean) => (open ? `${name} qrupunu yığ` : `${name} qrupunu aç`),
    listLabel: 'Serverlər',
    empty: 'Hələ server yoxdur. "Yeni server" düyməsi ilə əlavə edin.',
    emptySearch: 'Axtarışa uyğun server yoxdur.',
    loadFailed: 'Server siyahısı oxuna bilmədi.',
    retry: 'Yenidən cəhd et',
    count: (total: number, connected: number) =>
      connected > 0 ? `${total} server · ${connected} qoşulu` : `${total} server`,
    connected: 'Qoşulub',
    openTerminal: 'Terminal aç',
    openTerminalFor: (name: string) => `${name}: yeni terminal`,
    edit: 'Redaktə et…',
    duplicate: 'Kopyasını çıxar',
    copyAddress: 'Ünvanı kopyala',
    remove: 'Sil…',
    rowMenu: (name: string) => `${name} menyusu`,
    addressCopied: 'Ünvan kopyalandı',
    jumpVia: (name: string) => `jump host: ${name}`,
    copySuffix: ' (kopya)',
    environments: { prod: 'prod', preprod: 'preprod', dev: 'dev' },
    exported: (count: number) => `${count} server fayla yazıldı. Parollar fayla düşmədi.`,
    imported: (added: number, skipped: number, invalid: number) =>
      [
        `${added} server əlavə olundu.`,
        skipped > 0 ? `${skipped} server artıq var idi, toxunmadım.` : '',
        invalid > 0 ? `${invalid} yazı oxuna bilmədi.` : ''
      ]
        .filter(Boolean)
        .join(' '),
    transferFailed: {
      read: 'Fayl oxuna bilmədi.',
      write: 'Fayl yazıla bilmədi.',
      format: 'Bu fayl AgentGrid-in server siyahısı deyil.',
      'too-many': 'Server limiti (500) aşılır, idxal edilmədi.'
    },
    deleteDialog: {
      title: 'Server silinsin?',
      text: (name: string) =>
        `"${name}" siyahıdan silinəcək, saxlanmış parolu da silinəcək. Açıq terminallar bağlanmayacaq.`,
      usedAsJump: (count: number) => ` ${count} server bunu jump host kimi işlədir, onlarda jump host götürüləcək.`,
      confirm: 'Sil'
    },
    editor: {
      createTitle: 'Yeni server',
      editTitle: 'Serveri redaktə et',
      name: 'Ad',
      group: 'Müştəri / qrup',
      groupHint: 'Siyahıda serverlər bu ada görə qruplaşır.',
      address: 'Ünvan',
      addressPlaceholder: '10.20.4.11 və ya server.example.com',
      port: 'Port',
      username: 'İstifadəçi',
      auth: 'Giriş üsulu',
      authPassword: 'Parol',
      authKey: 'SSH açarı',
      authAgent: 'ssh-agent',
      password: 'Parol',
      passwordStoredPlaceholder: '•••••••• (saxlanıb)',
      passwordHint: 'Windows-un şifrələməsi ilə yalnız bu kompüterdə saxlanır. Boş qoysanız, qoşulanda soruşulacaq.',
      passwordKeepHint: 'Parol saxlanıb. Dəyişmək üçün yenisini yazın, boş qoysanız köhnəsi qalır.',
      forgetPassword: 'Saxlanmış parolu sil',
      passwordWillBeRemoved: 'Saxlanmış parol silinəcək.',
      keepPassword: 'Silmə',
      keyFile: 'Açar faylı',
      chooseKey: 'Seç…',
      noKey: 'Fayl seçilməyib',
      passphrase: 'Açarın parolu (varsa)',
      passphraseStoredPlaceholder: '•••••••• (saxlanıb)',
      agentHint: 'Windows-un OpenSSH agentindəki açarlar işlədiləcək.',
      environment: 'Mühit',
      environmentNone: 'Seçilməyib',
      prodNote: 'Prod serverə qoşulmazdan əvvəl təsdiq soruşulacaq və terminalın çərçivəsi qırmızı olacaq.',
      jump: 'Jump host',
      jumpNone: 'Yoxdur (birbaşa qoşul)',
      note: 'Qeyd',
      test: 'Bağlantını yoxla',
      testing: 'Yoxlanır…',
      testOk: 'Bağlantı alındı, giriş uğurludur.',
      cancel: 'Ləğv et',
      save: 'Saxla',
      saved: (name: string) => `"${name}" saxlandı.`,
      errors: {
        nameRequired: 'Ad boş ola bilməz.',
        addressInvalid: 'Ünvan düzgün deyil: boşluq və xüsusi simvol olmamalıdır.',
        portInvalid: 'Port 1 ilə 65535 arasında olmalıdır.',
        usernameInvalid: 'İstifadəçi adı düzgün deyil: boşluq olmamalıdır.',
        keyRequired: 'SSH açarı faylını seçin.',
        'too-many': 'Server limiti dolub (500).',
        'jump-missing': 'Seçilmiş jump host artıq yoxdur.',
        'jump-nested':
          'Jump host-un özünün jump host-u ola bilməz. Başqa serverlərin jump host kimi işlətdiyi serverə də jump host verilə bilməz.',
        invalid: 'Məlumat düzgün deyil.',
        saveFailed: 'Saxlamaq alınmadı.'
      }
    }
  },
  ssh: {
    badge: 'SSH',
    latency: (ms: number) => `${ms} ms`,
    phase: (phase: 'connecting' | 'authenticating', host: string) =>
      phase === 'connecting' ? `${host}: qoşulur…` : `${host}: giriş yoxlanır…`,
    starting: 'Qoşulur…',
    cancel: 'Ləğv et',
    connect: 'Qoşul',
    savedTitle: 'SSH terminalı',
    savedText: (name: string, endpoint: string) => `${name} · ${endpoint}. Bağlantı yoxdur.`,
    hostGone: 'Bu server siyahıdan silinib.',
    prodTitle: 'Bu PROD serverdir',
    prodText: (name: string, group: string) => (group ? `${name} (${group})` : name),
    prodHint: 'Enter: qoşul · Esc: ləğv et',
    hostKeyTitle: 'Bu serverə ilk dəfə qoşulursunuz',
    hostKeyText: (host: string, address: string) =>
      `${host} (${address}) serverinin barmaq izi hələ tanınmır. Barmaq izi serverin administratorunun verdiyi ilə eynidirsə, qəbul edin.`,
    hostKeyAccept: 'Qəbul et və qoşul',
    hostKeyReject: 'Ləğv et',
    promptTitle: (kind: 'password' | 'passphrase' | 'keyboard-interactive', host: string) =>
      kind === 'password'
        ? `${host}: parol`
        : kind === 'passphrase'
          ? `${host}: açarın parolu`
          : `${host}: əlavə yoxlama`,
    answerLabel: (index: number) => `Cavab ${index + 1}`,
    remember: 'Yadda saxla (şifrəli, yalnız bu kompüterdə)',
    submit: 'Davam et',
    exitedBar: (code: number) => `Bağlantı bağlandı (çıxış kodu ${code})`,
    lostBar: 'Bağlantı qopdu',
    closedBar: 'Bağlantı bağlandı',
    reconnect: 'Yenidən qoşul',
    errorTitle: 'Qoşulmaq alınmadı',
    forgetKey: 'Köhnə izi unut və yenidən qoşul',
    forgetKeyWarning:
      'Bunu yalnız serverin açarının həqiqətən dəyişdiyini bilirsinizsə edin (məsələn, server yenidən qurulub). Əks halda kimsə bağlantını ələ keçirməyə çalışa bilər.',
    keyNotForgotten: (file: string) =>
      `Köhnə iz AgentGrid-in faylında deyil. Onu bu fayldan özünüz silməlisiniz: ${file}`,
    statusConnected: (count: number) => `SSH: ${count} qoşulu`,
    exitMessage: (reason: 'exit' | 'lost' | 'closed', code: number) =>
      reason === 'lost'
        ? '[Bağlantı qopdu]'
        : reason === 'closed'
          ? '[Bağlantı bağlandı]'
          : `[Bağlantı bağlandı, çıxış kodu ${code}]`,
    errorText: (code: SshErrorCode, host: string, message: string): string => {
      const name = host || 'Server'
      switch (code) {
        case 'host-missing':
          return 'Bu server siyahıda yoxdur, silinib.'
        case 'helper-missing':
          return 'SSH köməkçi proqramı (agentgrid-ssh.exe) tapılmadı. Proqramı yenidən quraşdırın.'
        case 'duplicate-id':
          return 'Bu terminal artıq qoşulub.'
        case 'dns':
          return `${name}: ünvan tapılmadı. Ünvanı və VPN-i yoxlayın.`
        case 'refused':
          return `${name} bağlantını rədd etdi. Port düzgündür? Serverdə SSH işləyir?`
        case 'timeout':
          return `${name} cavab vermədi. Şəbəkəni və VPN-i yoxlayın.`
        case 'unreachable':
          return `${name} əlçatan deyil. Şəbəkəni və VPN-i yoxlayın.`
        case 'auth':
          return `${name}: giriş alınmadı. İstifadəçi adı, parol və ya açar səhvdir.`
        case 'hostkey-changed':
          return `${name} serverinin barmaq izi dəyişib. Bu, server yenidən qurulanda olur, amma kimsə bağlantını ələ keçirməyə çalışanda da olur. Qoşulmadım.`
        case 'hostkey-rejected':
          return 'Barmaq izi qəbul edilmədi, qoşulmadım.'
        case 'cancelled':
          return 'Qoşulma ləğv edildi.'
        case 'key-file':
          return `Açar faylı oxuna bilmədi. ${message}`
        case 'agent-unavailable':
          return 'ssh-agent işləmir. Windows-da "OpenSSH Authentication Agent" xidmətini başladın.'
        case 'jump':
          return `Jump host ilə problem: ${message}`
        case 'other':
          return message ? `Xəta: ${message}` : 'Naməlum xəta.'
      }
    }
  },
  sftp: {
    badge: 'SFTP',
    paneTitle: (name: string) => `SFTP · ${name}`,
    open: 'SFTP aç',
    openFor: (name: string) => `${name}: SFTP`,
    openSideBySide: 'Terminal + SFTP yan-yana',
    openFromPane: 'Bu serverin faylları (SFTP)',
    local: 'Bu kompüter',
    remote: 'Server',
    up: 'Yuxarı qovluq',
    refresh: 'Yenilə',
    showHidden: 'Gizli faylları göstər',
    pathLabel: (side: string) => `${side}: qovluq yolu`,
    newFolder: 'Yeni qovluq',
    upload: 'Yüklə',
    uploadPick: 'Faylları seçib yüklə…',
    download: 'Endir',
    rename: 'Adını dəyiş…',
    permissions: 'İcazələr…',
    copyPath: 'Yolu kopyala',
    reveal: 'Explorer-də göstər',
    remove: 'Sil…',
    columns: { name: 'Ad', size: 'Ölçü', modified: 'Dəyişib', mode: 'İcazələr' },
    listLabel: (side: string) => `${side}: fayllar`,
    empty: 'Qovluq boşdur.',
    loading: 'Yüklənir…',
    dropHint: 'Faylları Explorer-dən bura atın və ya o biri tərəfdən sürükləyin.',
    selection: (count: number) => `${count} seçilib`,
    items: (count: number) => `${count} element`,
    typeahead: (query: string, found: boolean) => (found ? `Axtarış: ${query}` : `«${query}» ilə başlayan fayl yoxdur`),
    connecting: 'SFTP qoşulur…',
    editInEditor: 'Redaktorda aç',
    editing: {
      label: 'Redaktə olunan fayllar',
      downloading: 'açılır…',
      watching: 'saxlayanda serverə yüklənəcək',
      uploading: 'serverə yüklənir…',
      saved: (name: string) => `${name} serverə yükləndi`,
      failed: (name: string, message: string) => `${name} serverə yüklənmədi: ${message}`,
      openFailed: (name: string) => `${name} redaktorda açıla bilmədi`,
      stop: (name: string) => `${name} izləməsini dayandır`
    },
    resume: 'Davam et',
    resumeLabel: (name: string) => `${name} köçürməsini davam etdir`,
    follow: 'Terminalın qovluğunu izlə',
    followUnavailable:
      'Terminal olduğu qovluğu bildirmir. Bunun üçün serverdə shell qovluğu OSC 7 ilə göndərməlidir (README-də bir sətirlik nümunə var).',
    savedTitle: 'SFTP paneli',
    savedText: (name: string) => `${name} · SFTP. Bağlantı yoxdur.`,
    closedBar: 'SFTP bağlantısı bağlandı',
    lostBar: 'SFTP bağlantısı qopdu',
    pathCopied: 'Yol kopyalandı',
    errors: {
      'not-found': 'Belə fayl və ya qovluq yoxdur.',
      permission: 'İcazə yoxdur.',
      exists: 'Bu adda fayl artıq var.',
      'not-empty': 'Qovluq boş deyil.',
      connection: 'Bağlantı yoxdur.',
      failure: 'Əməliyyat alınmadı.',
      cancelled: 'Ləğv edildi.'
    },
    dialogs: {
      newFolderTitle: 'Yeni qovluq',
      renameTitle: 'Adını dəyiş',
      nameLabel: 'Ad',
      nameInvalid: 'Ad boş ola bilməz, / işarəsi olmaz.',
      chmodTitle: 'İcazələr',
      chmodLabel: 'Səkkizlik say (məs. 644 və ya 755)',
      chmodInvalid: 'Üç və ya dörd rəqəm yazın (0–7).',
      save: 'Saxla',
      create: 'Yarat',
      cancel: 'Ləğv et',
      deleteTitle: 'Silinsin?',
      deleteText: (names: string, folders: number) =>
        folders > 0
          ? `${names} serverdən silinəcək. Qovluqların içindəki hər şey də silinəcək. Bu geri qaytarılmır.`
          : `${names} serverdən silinəcək. Bu geri qaytarılmır.`,
      delete: 'Sil',
      overwriteTitle: 'Fayllar artıq var',
      overwriteText: (count: number, names: string) =>
        `${count} fayl hədəfdə artıq var (${names}). Üzərinə yazılsın?`,
      overwrite: 'Üzərinə yaz',
      skip: 'Olanları ötür'
    },
    transfers: {
      label: 'Köçürmələr',
      upload: 'Yükləmə',
      download: 'Endirmə',
      cancel: (name: string) => `${name} köçürməsini ləğv et`,
      clear: 'Bitənləri təmizlə',
      done: 'Hazırdır',
      cancelled: 'Ləğv edildi',
      failed: (message: string) => `Alınmadı: ${message}`,
      files: (done: number, total: number) => `${done}/${total} fayl`,
      speed: (text: string) => `${text}/s`,
      left: (text: string) => `qalıb ${text}`,
      waiting: 'Başlayır…',
      status: (count: number) => `${count} köçürmə`
    }
  },
  confirmClose: {
    title: 'Terminal bağlansın?',
    text: (title: string) =>
      `"${title}" hələ işləyir. Bağlasanız, içindəki proses dayandırılacaq və yazılmamış iş itə bilər.`,
    confirm: 'Bağla',
    cancel: 'Ləğv et'
  },
  toast: {
    projectOpened: (name: string) => `Layihə açıldı: ${name}`,
    projectPickFailed: 'Qovluq seçmək alınmadı',
    dismiss: 'Bağla'
  }
} as const
