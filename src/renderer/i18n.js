// Internationalisation — EN / FR
// Usage in HTML  : <el data-i18n="key">fallback</el>
//                  <input data-i18n-ph="key" placeholder="fallback" />
// Usage in JS    : t('key')

const TRANSLATIONS = {
    en: {
        // Nav
        'nav.download':  'Download',
        'nav.queue':     'Queue',
        'nav.history':   'History',
        'nav.convert':   'Convert',
        'nav.settings':  'Settings',
        'nav.about':     'About',

        // Download view
        'dl.title':           'Download',
        'dl.subtitle':        'YouTube · Vimeo · Instagram · Twitter · 1000+ sites',
        'dl.mode.single':     'Single video',
        'dl.mode.batch':      'Batch',
        'dl.url.placeholder': 'Paste a video or playlist URL…',
        'dl.btn.clear':       'Clear',
        'dl.btn.fetch':       'Fetch',
        'dl.section.video':   'Video',
        'dl.section.audio':   'Audio only',
        'dl.codec.label':     'Video codec',
        'dl.codec.copy':      'Original — Copy (recommended)',
        'dl.codec.h264':      'H.264 — Reduces size, universal compatibility',
        'dl.codec.h265':      'H.265 — More compact, for recent devices',
        'dl.trim.title':      'Trim clip',
        'dl.trim.clear':      'Clear',
        'dl.trim.open':       'Open ↗',
        'dl.trim.addSeg':     '+ Add segment',
        'dl.btn.addQueue':    'Add to Queue',
        'dl.pl.badge':        'PLAYLIST',
        'dl.pl.selectAll':    'Select all',
        'dl.pl.deselectAll':  'Deselect all',
        'dl.pl.formatAll':    'Format for all',
        'dl.pl.best':         'Best quality',
        'dl.pl.note':         "If a video doesn't have the selected quality, the best available will be used.",
        'dl.pl.addSelected':  'Add Selected to Queue',
        'dl.audio.mp3':       'MP3 (audio only)',
        'dl.audio.m4a':       'M4A (audio only)',
        'dl.audio.opus':      'OPUS (audio only)',
        'dl.audio.flac':      'FLAC (lossless)',
        'dl.audio.wav':       'WAV (lossless)',
        'dl.empty.title':     'Paste a video or playlist URL',
        'dl.empty.sub1':      'Press Ctrl+V or ⌘+V',
        'dl.empty.sub2':      'YouTube, Vimeo, Twitter, Instagram collections, and thousands more',
        'dl.fetchQ.title':    'Fetch Queue',
        'dl.fetchQ.clear':    'Clear',
        'dl.batch.quality':   'Quality',
        'dl.batch.best':      'Best',
        'dl.batch.4k':        'Up to 4K',
        'dl.batch.2k':        'Up to 2K',
        'dl.batch.1080p':     'Up to 1080p',
        'dl.batch.addQueue':  'Add to Queue',

        // Queue view
        'queue.title':       'Queue',
        'queue.start':       'Start Queue',
        'queue.pause':       'Pause',
        'queue.openFolder':  'Open folder',
        'queue.retryFailed': 'Retry failed',
        'queue.clearDone':   'Clear done',
        'queue.cancelAll':   'Cancel all',
        'queue.empty.title': 'Queue is empty',
        'queue.empty.sub':   'Fetch videos and click "Add to Queue" — then hit Start Queue when ready',

        // History view
        'history.title':       'History',
        'history.clearAll':    'Clear all',
        'history.empty.title': 'No history yet',
        'history.empty.sub':   'Videos you fetch will appear here',

        // Convert view
        'convert.title':         'Convert',
        'convert.subtitle':      'Trim and convert local media files',
        'convert.drop.title':    'Drop a media file or click to browse',
        'convert.drop.sub':      'MP4, MKV, MOV, AVI, WebM, MP3, WAV, FLAC, M4A…',
        'convert.changeFile':    'Change file',
        'convert.reset':         'Reset',
        'convert.trim.label':    'Trim',
        'convert.trim.optional': '(optional)',
        'convert.trim.clear':    'Clear',
        'convert.trim.now1':     '◀ Now',
        'convert.trim.now2':     'Now →',
        'convert.format.label':  'Output format',
        'convert.og.videoFast':  'Video — fast, no quality loss',
        'convert.og.audioOnly':  'Audio only',
        'convert.og.videoRe':    'Video — re-encode (smaller file, slower)',
        'convert.og.lossless':   'Audio lossless — only useful if source is uncompressed',
        'convert.og.rare':       'Rare formats',
        'convert.warn.lossy':    '⚠ FLAC/WAV only improves if source is lossless. On a compressed video, the file will be larger with no quality gain.',
        'convert.btn':           'Convert',

        // Settings view
        'settings.appearance':     'Appearance',
        'settings.theme':          'Theme',
        'settings.theme.system':   'Follows system',
        'settings.theme.dark':     'Dark',
        'settings.theme.light':    'Light',
        'settings.accentColor':    'Accent color',
        'settings.language':       'Language',
        'settings.storage':        'Storage',
        'settings.dlFolder':       'Download folder',
        'settings.change':         'Change',
        'settings.open':           'Open',
        'settings.reset.label':    'Reset app (clear cache)',
        'settings.reset.desc':     'Deletes all app data and restarts',
        'settings.reset.btn':      'Reset',
        'settings.yt.title':       'YouTube Account',
        'settings.yt.signin':      'YouTube sign-in',
        'settings.notSignedIn':    'Not signed in',
        'settings.signIn':         'Sign in',
        'settings.signOut':        'Sign out',
        'settings.yt.hint':        'Sign in to access age-restricted, private, and members-only videos. Your credentials go directly to Google — this app never sees your password.',
        'settings.insta.title':    'Instagram Account',
        'settings.insta.signin':   'Instagram sign-in',
        'settings.insta.hint':     'Sign in to download from your saved collections. Your credentials go directly to Instagram — this app never sees your password.',
        'settings.deps':           'Dependencies',
        'settings.checking':       'Checking…',

        // About view
        'about.checkUpdates':      'Check for updates',
        'about.description':       'I built bWeb to solve my own problem — downloading videos and audio without jumping through hoops. Works with YouTube, Vimeo, Twitter/X, Instagram, and 1000+ other sites. Everything stays on your machine. No cloud, no accounts, no tracking.',
        'about.reportBug':         'Report a Bug',
        'about.github':            'GitHub',
        'about.howWorks.title':    'How does it work?',
        'about.howWorks.text':     'Drop a URL, pick your format, and download. Queue up multiple videos at once, grab audio-only, or trim a clip before saving. Files land straight in your Downloads folder.',
        'about.downloads.title':   'Where are my downloads?',
        'about.downloads.text':    'Files are saved to your Downloads folder inside a bWeb subfolder by default. Change the location in',
        'about.downloads.link':    'Settings',
        'about.footer':            'Made by Baba · Open source',
        'about.poweredBy':         'Powered by',
        'about.basedOn':           'Based on',
        'about.by':                'by Archis',

        // Dynamic (renderer.js)
        'status.pending':     'Pending',
        'status.downloading': 'Downloading…',
        'status.complete':    'Complete',
        'status.failed':      'Failed',
        'status.cancelled':   'Cancelled',
        'status.paused':      'Paused',
        'action.retry':       'Retry',
        'action.cancel':      'Cancel',
        'action.remove':      'Remove',
        'action.download':    'Download again',
        'msg.items':          (n) => `${n} item${n !== 1 ? 's' : ''}`,
    },

    fr: {
        // Nav
        'nav.download':  'Télécharger',
        'nav.queue':     'Attente',
        'nav.history':   'Historique',
        'nav.convert':   'Convertir',
        'nav.settings':  'Paramètres',
        'nav.about':     'À propos',

        // Download view
        'dl.title':           'Télécharger',
        'dl.subtitle':        'YouTube · Vimeo · Instagram · Twitter · 1000+ sites',
        'dl.mode.single':     'Vidéo unique',
        'dl.mode.batch':      'Lot d\'URLs',
        'dl.url.placeholder': 'Coller une URL vidéo ou playlist…',
        'dl.btn.clear':       'Effacer',
        'dl.btn.fetch':       'Récupérer',
        'dl.section.video':   'Vidéo',
        'dl.section.audio':   'Audio seulement',
        'dl.codec.label':     'Codec vidéo',
        'dl.codec.copy':      'Original — Copie (recommandé)',
        'dl.codec.h264':      'H.264 — Réduit la taille, compatible partout',
        'dl.codec.h265':      'H.265 — Plus compact, appareils récents',
        'dl.trim.title':      'Couper le clip',
        'dl.trim.clear':      'Effacer',
        'dl.trim.open':       'Ouvrir ↗',
        'dl.trim.addSeg':     '+ Ajouter un segment',
        'dl.btn.addQueue':    'Ajouter à la file',
        'dl.pl.badge':        'PLAYLIST',
        'dl.pl.selectAll':    'Tout sélectionner',
        'dl.pl.deselectAll':  'Tout désélectionner',
        'dl.pl.formatAll':    'Format pour tous',
        'dl.pl.best':         'Meilleure qualité',
        'dl.pl.note':         "Si une vidéo n'a pas la qualité sélectionnée, la meilleure disponible sera utilisée.",
        'dl.pl.addSelected':  'Ajouter la sélection à la file',
        'dl.audio.mp3':       'MP3 (audio seulement)',
        'dl.audio.m4a':       'M4A (audio seulement)',
        'dl.audio.opus':      'OPUS (audio seulement)',
        'dl.audio.flac':      'FLAC (sans perte)',
        'dl.audio.wav':       'WAV (sans perte)',
        'dl.empty.title':     'Coller une URL vidéo ou playlist',
        'dl.empty.sub1':      'Appuyez sur Ctrl+V ou ⌘+V',
        'dl.empty.sub2':      'YouTube, Vimeo, Twitter, collections Instagram, et des milliers d\'autres',
        'dl.fetchQ.title':    'File de récupération',
        'dl.fetchQ.clear':    'Effacer',
        'dl.batch.quality':   'Qualité',
        'dl.batch.best':      'Meilleure',
        'dl.batch.4k':        'Jusqu\'à 4K',
        'dl.batch.2k':        'Jusqu\'à 2K',
        'dl.batch.1080p':     'Jusqu\'à 1080p',
        'dl.batch.addQueue':  'Ajouter à la file',

        // Queue view
        'queue.title':       'File d\'attente',
        'queue.start':       'Démarrer la file',
        'queue.pause':       'Pause',
        'queue.openFolder':  'Ouvrir le dossier',
        'queue.retryFailed': 'Réessayer les échecs',
        'queue.clearDone':   'Supprimer les terminés',
        'queue.cancelAll':   'Tout annuler',
        'queue.empty.title': 'File d\'attente vide',
        'queue.empty.sub':   'Récupérez des vidéos et cliquez sur "Ajouter à la file" — puis démarrez la file',

        // History view
        'history.title':       'Historique',
        'history.clearAll':    'Tout effacer',
        'history.empty.title': 'Aucun historique',
        'history.empty.sub':   'Les vidéos récupérées apparaîtront ici',

        // Convert view
        'convert.title':         'Convertir',
        'convert.subtitle':      'Couper et convertir des fichiers locaux',
        'convert.drop.title':    'Déposer un fichier ou cliquer pour parcourir',
        'convert.drop.sub':      'MP4, MKV, MOV, AVI, WebM, MP3, WAV, FLAC, M4A…',
        'convert.changeFile':    'Changer de fichier',
        'convert.reset':         'Réinitialiser',
        'convert.trim.label':    'Couper',
        'convert.trim.optional': '(optionnel)',
        'convert.trim.clear':    'Effacer',
        'convert.trim.now1':     '◀ Ici',
        'convert.trim.now2':     'Ici →',
        'convert.format.label':  'Format de sortie',
        'convert.og.videoFast':  'Vidéo — rapide, sans perte de qualité',
        'convert.og.audioOnly':  'Audio seulement',
        'convert.og.videoRe':    'Vidéo — réencodage (plus petit, plus lent)',
        'convert.og.lossless':   'Audio sans perte — utile seulement si la source est non compressée',
        'convert.og.rare':       'Formats rares',
        'convert.warn.lossy':    '⚠ FLAC/WAV ne s\'améliore que si la source est lossless. Sur une vidéo compressée, le fichier sera plus gros sans gain de qualité.',
        'convert.btn':           'Convertir',

        // Settings view
        'settings.appearance':     'Apparence',
        'settings.theme':          'Thème',
        'settings.theme.system':   'Suit le système',
        'settings.theme.dark':     'Sombre',
        'settings.theme.light':    'Clair',
        'settings.accentColor':    'Couleur d\'accent',
        'settings.language':       'Langue',
        'settings.storage':        'Stockage',
        'settings.dlFolder':       'Dossier de téléchargement',
        'settings.change':         'Changer',
        'settings.open':           'Ouvrir',
        'settings.reset.label':    'Réinitialiser l\'app (vider le cache)',
        'settings.reset.desc':     'Supprime toutes les données et redémarre',
        'settings.reset.btn':      'Réinitialiser',
        'settings.yt.title':       'Compte YouTube',
        'settings.yt.signin':      'Connexion YouTube',
        'settings.notSignedIn':    'Non connecté',
        'settings.signIn':         'Se connecter',
        'settings.signOut':        'Se déconnecter',
        'settings.yt.hint':        'Connectez-vous pour accéder aux vidéos restreintes, privées ou réservées aux membres. Vos identifiants vont directement à Google — cette app ne voit jamais votre mot de passe.',
        'settings.insta.title':    'Compte Instagram',
        'settings.insta.signin':   'Connexion Instagram',
        'settings.insta.hint':     'Connectez-vous pour télécharger depuis vos collections sauvegardées. Vos identifiants vont directement à Instagram — cette app ne voit jamais votre mot de passe.',
        'settings.deps':           'Dépendances',
        'settings.checking':       'Vérification…',

        // About view
        'about.checkUpdates':      'Vérifier les mises à jour',
        'about.description':       'J\'ai créé bWeb pour résoudre mon propre problème — télécharger des vidéos et de l\'audio sans prise de tête. Fonctionne avec YouTube, Vimeo, Twitter/X, Instagram et 1000+ autres sites. Tout reste sur ta machine. Pas de cloud, pas de compte, pas de tracking.',
        'about.reportBug':         'Signaler un bug',
        'about.github':            'GitHub',
        'about.howWorks.title':    'Comment ça marche ?',
        'about.howWorks.text':     'Colle une URL, choisis ton format, et c\'est parti. Mets plusieurs vidéos en file, récupère uniquement l\'audio, ou coupe un passage avant de télécharger. Les fichiers arrivent directement dans ton dossier Téléchargements.',
        'about.downloads.title':   'Où sont mes téléchargements ?',
        'about.downloads.text':    'Les fichiers sont sauvegardés dans votre dossier Téléchargements dans un sous-dossier bWeb par défaut. Modifiez l\'emplacement dans',
        'about.downloads.link':    'Paramètres',
        'about.footer':            'Créé par Baba · Open source',
        'about.poweredBy':         'Propulsé par',
        'about.basedOn':           'Basé sur',
        'about.by':                'par Archis',

        // Dynamic (renderer.js)
        'status.pending':     'En attente',
        'status.downloading': 'Téléchargement…',
        'status.complete':    'Terminé',
        'status.failed':      'Échec',
        'status.cancelled':   'Annulé',
        'status.paused':      'Pause',
        'action.retry':       'Réessayer',
        'action.cancel':      'Annuler',
        'action.remove':      'Supprimer',
        'action.download':    'Retélécharger',
        'msg.items':          (n) => `${n} élément${n !== 1 ? 's' : ''}`,
    },
};

let _lang = 'en';

function t(key) {
    const val = TRANSLATIONS[_lang]?.[key] ?? TRANSLATIONS.en[key];
    if (val === undefined) return key;
    return val;
}

function setLang(lang) {
    if (!TRANSLATIONS[lang]) return;
    _lang = lang;
    localStorage.setItem('lang', lang);
    applyTranslations();
    document.querySelectorAll('.lang-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
}

function applyTranslations() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    // Placeholder attributes
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
        el.placeholder = t(el.dataset.i18nPh);
    });
    // <optgroup label=""> — must update via JS property
    const ogMap = {
        'convert.og.videoFast': 0,
        'convert.og.audioOnly': 1,
        'convert.og.videoRe':   2,
        'convert.og.lossless':  3,
        'convert.og.rare':      4,
    };
    const convertSelect = document.getElementById('convertFormat');
    if (convertSelect) {
        const groups = convertSelect.querySelectorAll('optgroup');
        Object.entries(ogMap).forEach(([key, idx]) => {
            if (groups[idx]) groups[idx].label = t(key);
        });
    }
    // Warn text (has HTML entities — update innerHTML)
    const lossyWarn = document.getElementById('convertLossyWarn');
    if (lossyWarn) lossyWarn.textContent = t('convert.warn.lossy');
}

function initLang() {
    _lang = localStorage.getItem('lang') || 'en';
    applyTranslations();
    requestAnimationFrame(() => {
        document.querySelectorAll('.lang-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.lang === _lang);
        });
    });
}
