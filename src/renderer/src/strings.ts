import type { TerminalErrorCode } from '@shared/ipc'

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
      delete: 'Sil',
      switchTitle: 'İş sahəsi dəyişdirilsin?',
      switchText: (running: number, name: string) =>
        `Hazırkı iş sahəsində ${running} işləyən terminal var. "${name}" iş sahəsinə keçsəniz, onlar dayandırılacaq. Düzülüş və terminal konfiqurasiyası yadda qalacaq.`,
      switch: 'Dayandır və keç'
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
    dropped: (count: number) => `${count} iş sahəsi oxuna bilmədi və atlandı.`
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
