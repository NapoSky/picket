const translations = {
  en: {
    recentTitle: 'Recent presences',
    recentHelp: 'Latest 100 observed segments in this period',
    joined: 'Joined',
    left: 'Left / confirmed until',
    quality: 'Observation',
    observed: 'Observed',
    snapshot: 'State snapshot',
    interrupted: 'Interrupted',
    replayed: 'Replayed',
    channel: 'Channel',
    allChannels: 'All channels',
    hourlyTitle: 'When people gather',
    hourlyHelp: 'Voice hours by local hour of day',
    peak: 'Peak simultaneous presences',
    previous: 'Previous',
    next: 'Next',
    eraseAll: 'Erase all my data',
    eraseAllHelp:
      'Erase your activity and opt out across this instance, including servers you have left. This cannot be undone.',
    skip: 'Skip to content',
    watchpost: 'REGIMENT WATCHPOST',
    language: 'Language',
    theme: 'Theme',
    system: 'System',
    dark: 'Dark',
    light: 'Light',
    logout: 'Sign out',
    voiceOnly: 'VOICE ACTIVITY · 60 DAYS',
    signIn: 'Sign in',
    startupLoading: 'Loading…',
    retry: 'Retry',
    welcomeTitle: 'Sign in to PICKET',
    welcomeText:
      'Access your voice activity and your regiment’s dashboards.',
    login: 'SSO Discord',
    loginHelp: 'You’ll be redirected to Discord to sign in.',
    loginAccess: 'Your permissions determine which dashboards you can access.',
    workspace: 'WORKSPACE',
    picket: 'PICKET overview',
    picketDescription: 'Deployment and feature adoption across this PICKET instance.',
    scopeShared: 'SHARED INSTANCE FIGURES',
    activeServers: 'Active Discord servers',
    activeServersHelp: 'Servers currently registered as active on this instance',
    featureAdoption: 'Feature adoption',
    featureAdoptionHelp: 'Share of active servers with each feature enabled',
    enabledServers: 'servers with this feature enabled',
    featureTimers: 'Timers',
    featureTodolists: 'TodoLists',
    featureWarlog: 'Warlog',
    featureStats: 'Voice stats',
    serverFeatures: 'Server features',
    serverFeaturesHelp: 'Current settings for this server, independent of the period and channel filters.',
    featureEnabled: 'Enabled',
    featureDisabled: 'Disabled',
    instanceHelperTitle: 'How these figures are counted',
    instanceHelper: 'These are current settings, not usage counts. Servers where PICKET has left or been suspended are excluded. A server can enable several features, so feature counts overlap. Voice tracking can be disabled while the server remains active.',
    overview: 'Overview',
    activity: 'Voice activity',
    admin: 'Administration',
    retention: '60-day retention',
    presenceNote: 'Presence, not speaking time.',
    server: 'Server',
    period: 'Period',
    last1: 'Last 24 hours',
    last7: 'Last 7 days',
    last14: 'Last 14 days',
    last30: 'Last 30 days',
    last60: 'Last 60 days',
    view: 'View',
    myData: 'My activity',
    regimentData: 'Regiment activity',
    refresh: 'Refresh',
    emptyTitle: 'Nothing to show yet',
    emptyText: 'There is no recorded voice presence for this period. Try a longer period or another server.',
    voiceHours: 'Voice hours',
    voiceHoursHelp: 'Combined time in eligible channels',
    activePeople: 'Active people',
    activePeopleHelp: 'Unique people in this period',
    presences: 'Presence segments',
    presencesHelp: 'A new segment for each channel change',
    inVoice: 'Currently in voice',
    inVoiceHelp: 'Last confirmed connected people',
    dailyTitle: 'Activity over time',
    dailyHelp: 'Total voice presence by day',
    serverVoiceTitle: 'Voice activity by server',
    serverVoiceHelp: 'Each server is a layer; voice hours add up. Hover or use arrow keys for daily figures.',
    peopleDailyTitle: 'Active people over time',
    peopleDailyHelp: 'Distinct people with voice activity each day. Hover or use arrow keys for daily figures.',
    peopleDailyGlobalHelp: 'One curve per server. The dashed total counts each person once across servers.',
    uniquePeopleAllServers: 'All servers · unique people',
    globalUniquePeopleHelp: 'Each person counted once across servers in this period',
    serverSummaryTitle: 'Activity by server',
    serverSummaryHelp: 'People and voice activity across the selected period',
    otherSeries: 'more servers',
    hours: 'Hours',
    channelsTitle: 'Where people gather',
    channelsHelp: 'Voice time by channel',
    exportCSV: 'Export CSV',
    exportJSON: 'JSON',
    person: 'Person',
    voiceTime: 'Voice time',
    lastPresence: 'Last observed presence',
    truncated: 'More people are available on the next page. Exports include up to 10,000 people.',
    collectionTitle: 'Collection health',
    collectionHelp: 'Persistent buffer awaiting database recovery',
    helperTitle: 'How to read these statistics',
    helperPresence:
      'Voice time measures presence in a channel. It does not measure speaking time or prove that someone is playing.',
    helperFilters:
      'Bots, the AFK channel, excluded channels and people outside the selected member roles are not included.',
    helperGaps: 'Collection interruptions are marked. Unobserved time is not automatically credited.',
    helperRetention:
      'All statistical history covers a maximum of 60 days. “No observed activity” does not mean “never active”.',
    privacyTitle: 'Your data, your choice',
    privacyUnavailable: 'Your privacy preferences could not be loaded. These actions are temporarily unavailable. Use Refresh to try again.',
    discordRateLimited: 'Discord is limiting access checks. Retry in {seconds} seconds.',
    dashboardRateLimited: 'Too many dashboard requests. Retry in {seconds} seconds.',
    discordUnavailable: 'Discord access checks are temporarily unavailable. Try again shortly.',
    loadFailed: 'Activity could not be loaded.',
    staleData: 'Update failed. Previous figures are shown.',
    privacyHelp:
      'Manage tracking for your account in the selected server. Erasure also removes your contribution from the statistics.',
    optOut: 'Exclude me from future tracking',
    savePrivacy: 'Save preference',
    erase: 'Erase my statistics',
    footer: 'Your regiment. In sync.',
    documentation: 'Documentation',
    loginResources: 'PICKET resources',
    privacyPolicy: 'Privacy Policy',
    termsOfService: 'Terms of Service',
    eraseTitle: 'Erase your statistics?',
    eraseHelp:
      'This removes your recorded activity in the selected server, including pending records. It cannot be undone.',
    eraseConfirm: 'Type DELETE to confirm',
    cancel: 'Cancel',
    overviewDescription: 'Your regiment’s activity, without exposing individual histories.',
    activityDescription: 'Understand your voice presence and the channels you use.',
    adminDescription: 'Activity across the servers managed by this PICKET instance.',
    hello: 'WELCOME BACK',
    scopeOverview: 'SERVER OVERVIEW',
    scopeSelf: 'YOUR DATA ONLY',
    scopeGuild: 'REGIMENT DATA',
    scopeGlobal: 'INSTANCE ACCESS',
    allServers: 'All servers',
    updated: 'Updated',
    snapshotAsOf: 'Data as of',
    snapshotVoice: 'In voice at snapshot',
    snapshotVoiceHelp: 'Connected people at the last scheduled update',
    snapshotPending: 'The instance statistics are being updated. Please try again shortly.',
    notUpdated: 'Waiting for a first observation',
    timezone: 'Daily totals in',
    loading: 'Loading activity…',
    paused:
      'Voice tracking is disabled for this server. Existing history remains available until it expires.',
    inactiveServer: 'Inactive',
    activeServerGroup: 'Active servers',
    inactiveServerGroup: 'Inactive servers',
    unknownServer: 'Unknown server',
    inactiveHelp: 'PICKET is inactive on this server. Its retained history remains available until expiry or erasure.',
    gap: 'Some presence segments include a collection interruption. Unobserved time has been excluded.',
    late: 'Collection has not been confirmed recently. The figures may be delayed.',
    peopleTitle: 'Recorded activity',
    peopleDescription: 'Only the people you are authorized to view.',
    myTitle: 'Your recorded activity',
    myDescription: 'Your data in the selected server.',
    noChannels: 'No channel activity in this period.',
    noGuilds: 'No accessible server is currently registered with this PICKET instance.',
    saved: 'Your tracking preference has been saved.',
    erased: 'Your statistics have been erased.',
    bufferRecords: 'Pending records',
    bufferSize: 'Disk usage',
    bufferOldest: 'Oldest pending record',
    bufferEmpty: 'No pending records',
    error: 'The service is temporarily unavailable. Please try again.',
    forbidden: 'Your access has changed. Refresh or choose another server.',
    invalidPeriod: 'Choose a period within the last 60 days.',
    exportTooLarge: 'This export is too large. Choose a shorter period.',
    confirmErase: 'Confirm your erasure request.',
    chartDescription: 'Voice hours per day',
    sessionExpired: 'Your session has expired. Sign in again.',
  },
  fr: {
    recentTitle: 'Présences récentes',
    recentHelp: '100 derniers segments observés sur cette période',
    joined: 'Connexion',
    left: 'Déconnexion / confirmation jusqu’à',
    quality: 'Observation',
    observed: 'Observée',
    snapshot: 'État constaté',
    interrupted: 'Interrompue',
    replayed: 'Rejouée',
    channel: 'Salon',
    allChannels: 'Tous les salons',
    hourlyTitle: 'Les horaires de rassemblement',
    hourlyHelp: 'Heures vocales par heure locale',
    peak: 'Pic de présences simultanées',
    previous: 'Précédent',
    next: 'Suivant',
    eraseAll: 'Effacer toutes mes données',
    eraseAllHelp:
      'Effacez votre activité et désactivez votre suivi dans cette instance, y compris sur les serveurs quittés. Cette action est irréversible.',
    skip: 'Aller au contenu',
    watchpost: 'POSTE DE VEILLE DU RÉGIMENT',
    language: 'Langue',
    theme: 'Thème',
    system: 'Système',
    dark: 'Sombre',
    light: 'Clair',
    logout: 'Déconnexion',
    voiceOnly: 'ACTIVITÉ VOCALE · 60 JOURS',
    signIn: 'Connexion',
    startupLoading: 'Chargement en cours…',
    retry: 'Réessayer',
    welcomeTitle: 'Connexion à PICKET',
    welcomeText:
      'Retrouvez votre activité vocale et les tableaux de bord de votre régiment.',
    login: 'SSO Discord',
    loginHelp:
      'Vous serez redirigé vers Discord pour vous connecter.',
    loginAccess: 'Vos permissions déterminent les tableaux de bord auxquels vous avez accès.',
    workspace: 'ESPACE DE TRAVAIL',
    picket: 'Vue globale PICKET',
    picketDescription: 'Déploiement et activation des fonctionnalités sur cette instance PICKET.',
    scopeShared: 'CHIFFRES GLOBAUX PARTAGÉS',
    activeServers: 'Serveurs Discord actifs',
    activeServersHelp: 'Serveurs actuellement enregistrés comme actifs sur cette instance',
    featureAdoption: 'Adoption des fonctionnalités',
    featureAdoptionHelp: 'Part des serveurs actifs où chaque fonctionnalité est activée',
    enabledServers: 'serveurs avec cette fonctionnalité activée',
    featureTimers: 'Timers',
    featureTodolists: 'TodoLists',
    featureWarlog: 'Warlog',
    featureStats: 'Statistiques vocales',
    serverFeatures: 'Fonctionnalités du serveur',
    serverFeaturesHelp: 'Réglages actuels de ce serveur, indépendants des filtres de période et de salon.',
    featureEnabled: 'Activé',
    featureDisabled: 'Désactivé',
    instanceHelperTitle: 'Comment ces chiffres sont calculés',
    instanceHelper: 'Ces chiffres décrivent les réglages actuels, pas le nombre d’utilisations. Les serveurs quittés par PICKET ou suspendus sont exclus. Un serveur peut activer plusieurs fonctionnalités : leurs effectifs se recoupent. Le suivi vocal peut être désactivé alors que le serveur reste actif.',
    overview: 'Vue d’ensemble',
    activity: 'Activité vocale',
    admin: 'Administration',
    retention: 'Conservation de 60 jours',
    presenceNote: 'Temps de présence, pas de parole.',
    server: 'Serveur',
    period: 'Période',
    last1: 'Dernières 24 heures',
    last7: '7 derniers jours',
    last14: '14 derniers jours',
    last30: '30 derniers jours',
    last60: '60 derniers jours',
    view: 'Vue',
    myData: 'Mon activité',
    regimentData: 'Activité du régiment',
    refresh: 'Actualiser',
    emptyTitle: 'Aucune donnée pour le moment',
    emptyText:
      'Aucune présence vocale n’a été enregistrée sur cette période. Essayez une période plus longue ou un autre serveur.',
    voiceHours: 'Heures vocales',
    voiceHoursHelp: 'Temps cumulé dans les salons éligibles',
    activePeople: 'Personnes actives',
    activePeopleHelp: 'Personnes uniques sur la période',
    presences: 'Segments de présence',
    presencesHelp: 'Un nouveau segment à chaque changement de salon',
    inVoice: 'Actuellement en vocal',
    inVoiceHelp: 'Dernières présences connectées confirmées',
    dailyTitle: 'L’activité au fil des jours',
    dailyHelp: 'Présence vocale cumulée par jour',
    serverVoiceTitle: 'Activité vocale par serveur',
    serverVoiceHelp: 'Chaque serveur est une couche ; les heures vocales s’additionnent. Survolez ou utilisez les flèches pour les chiffres quotidiens.',
    peopleDailyTitle: 'Les personnes actives au fil des jours',
    peopleDailyHelp: 'Personnes distinctes ayant une présence vocale chaque jour. Survolez ou utilisez les flèches pour les chiffres quotidiens.',
    peopleDailyGlobalHelp: 'Une courbe par serveur. Le total en pointillés compte chaque personne une seule fois entre les serveurs.',
    uniquePeopleAllServers: 'Tous les serveurs · personnes uniques',
    globalUniquePeopleHelp: 'Chaque personne comptée une seule fois entre les serveurs sur la période',
    serverSummaryTitle: 'Activité par serveur',
    serverSummaryHelp: 'Personnes et activité vocale sur la période sélectionnée',
    otherSeries: 'autres serveurs',
    hours: 'Heures',
    channelsTitle: 'Les lieux de rassemblement',
    channelsHelp: 'Temps vocal par salon',
    exportCSV: 'Exporter en CSV',
    exportJSON: 'JSON',
    person: 'Personne',
    voiceTime: 'Temps vocal',
    lastPresence: 'Dernière présence observée',
    truncated:
      'D’autres personnes sont disponibles à la page suivante. Les exports incluent jusqu’à 10 000 personnes.',
    collectionTitle: 'État de la collecte',
    collectionHelp: 'Tampon persistant en attente de reprise de la base',
    helperTitle: 'Comprendre ces statistiques',
    helperPresence:
      'Le temps vocal mesure une présence dans un salon. Il ne mesure pas le temps de parole et ne prouve pas qu’une personne joue.',
    helperFilters:
      'Les bots, le salon AFK, les salons exclus et les personnes sans rôle membre ciblé ne sont pas comptés.',
    helperGaps:
      'Les interruptions de collecte sont signalées. Le temps non observé n’est pas crédité automatiquement.',
    helperRetention:
      'L’historique statistique couvre au maximum 60 jours. « Aucune activité observée » ne signifie pas « jamais actif ».',
    privacyTitle: 'Vos données, votre choix',
    privacyUnavailable: 'Vos préférences de confidentialité n’ont pas pu être chargées. Ces actions sont temporairement indisponibles. Utilisez Actualiser pour réessayer.',
    discordRateLimited: 'Discord limite les vérifications d’accès. Nouvelle tentative dans {seconds} secondes.',
    dashboardRateLimited: 'Trop de requêtes vers le tableau de bord. Nouvelle tentative dans {seconds} secondes.',
    discordUnavailable: 'Les vérifications d’accès Discord sont temporairement indisponibles. Réessayez dans un instant.',
    loadFailed: 'L’activité n’a pas pu être chargée.',
    staleData: 'Échec de l’actualisation. Les chiffres précédents restent affichés.',
    privacyHelp:
      'Gérez le suivi de votre compte sur le serveur sélectionné. L’effacement retire également votre contribution des statistiques.',
    optOut: 'M’exclure des prochaines collectes',
    savePrivacy: 'Enregistrer ma préférence',
    erase: 'Effacer mes statistiques',
    footer: 'Votre régiment. En phase.',
    documentation: 'Documentation',
    loginResources: 'Ressources PICKET',
    privacyPolicy: 'Confidentialité',
    termsOfService: 'Conditions d’utilisation',
    eraseTitle: 'Effacer vos statistiques ?',
    eraseHelp:
      'Cette action supprime votre activité enregistrée sur le serveur sélectionné, y compris les données en attente. Elle est irréversible.',
    eraseConfirm: 'Saisissez DELETE pour confirmer',
    cancel: 'Annuler',
    overviewDescription: 'L’activité de votre régiment, sans exposer les historiques individuels.',
    activityDescription: 'Comprenez votre présence vocale et les salons que vous fréquentez.',
    adminDescription: 'L’activité des serveurs gérés par cette instance PICKET.',
    hello: 'VOTRE POSTE DE VEILLE',
    scopeOverview: 'VUE DU SERVEUR',
    scopeSelf: 'VOS DONNÉES UNIQUEMENT',
    scopeGuild: 'DONNÉES DU RÉGIMENT',
    scopeGlobal: 'ACCÈS À L’INSTANCE',
    allServers: 'Tous les serveurs',
    updated: 'Actualisé',
    snapshotAsOf: 'Données arrêtées au',
    snapshotVoice: 'En vocal à cette date',
    snapshotVoiceHelp: 'Personnes connectées lors de la dernière actualisation planifiée',
    snapshotPending: 'Les statistiques de l’instance sont en cours d’actualisation. Réessayez dans quelques instants.',
    notUpdated: 'En attente d’une première observation',
    timezone: 'Totaux journaliers en',
    loading: 'Chargement de l’activité…',
    paused:
      'La collecte vocale est désactivée pour ce serveur. L’historique reste disponible jusqu’à son expiration.',
    inactiveServer: 'Inactif',
    activeServerGroup: 'Serveurs actifs',
    inactiveServerGroup: 'Serveurs inactifs',
    unknownServer: 'Serveur inconnu',
    inactiveHelp: 'PICKET est inactif sur ce serveur. L’historique conservé reste consultable jusqu’à son expiration ou son effacement.',
    gap: 'Certains segments de présence comprennent une interruption de collecte. Le temps non observé a été exclu.',
    late: 'La collecte n’a pas été confirmée récemment. Les chiffres peuvent être en retard.',
    peopleTitle: 'Activité enregistrée',
    peopleDescription: 'Uniquement les personnes que vous êtes autorisé à consulter.',
    myTitle: 'Votre activité enregistrée',
    myDescription: 'Vos données sur le serveur sélectionné.',
    noChannels: 'Aucune activité par salon sur cette période.',
    noGuilds: 'Aucun serveur accessible n’est actuellement enregistré auprès de cette instance PICKET.',
    saved: 'Votre préférence de suivi a été enregistrée.',
    erased: 'Vos statistiques ont été effacées.',
    bufferRecords: 'Événements en attente',
    bufferSize: 'Espace disque utilisé',
    bufferOldest: 'Plus ancien événement',
    bufferEmpty: 'Aucun événement en attente',
    error: 'Le service est temporairement indisponible. Réessayez dans un instant.',
    forbidden: 'Vos droits ont changé. Actualisez ou choisissez un autre serveur.',
    invalidPeriod: 'Choisissez une période dans les 60 derniers jours.',
    exportTooLarge: 'Cet export est trop volumineux. Choisissez une période plus courte.',
    confirmErase: 'Confirmez votre demande d’effacement.',
    chartDescription: 'Heures vocales par jour',
    sessionExpired: 'Votre session a expiré. Connectez-vous à nouveau.',
  },
};
const $ = (id) => document.getElementById(id);
if (document.documentElement.dataset.development === 'true') {
  translations.en.login = 'Preview session';
  translations.fr.login = 'Session de démonstration';
  translations.en.loginHelp = 'A local session with a simulated Discord identity.';
  translations.fr.loginHelp = 'Une session locale avec une identité Discord simulée.';
}
let language = ['en', 'fr'].includes(localStorage.getItem('picket-language'))
  ? localStorage.getItem('picket-language')
  : navigator.language.startsWith('fr')
    ? 'fr'
    : 'en';
let theme = ['system', 'dark', 'light'].includes(localStorage.getItem('picket-theme'))
  ? localStorage.getItem('picket-theme')
  : 'system';
let current = null,
  guilds = [],
  page = 'overview',
  report = null,
  generation = 0,
  loading = false,
  offset = 0,
  eraseAll = false;
let instanceReport = null;
let privacyFailure = null;
let startupFailure = null;
let loadFailure = null;
let retryFailure = null;
let retryAt = 0;
let displayedReportKey = null;
const privacyCache = new Map();
let overviewPage = 'overview';
const t = (key) => translations[language][key] ?? translations.en[key] ?? key;
const featureLabels = { timers: 'featureTimers', todolists: 'featureTodolists', warlog: 'featureWarlog', stats: 'featureStats' };
const number = (value, decimals = 0) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: decimals }).format(value);
const date = (value) =>
  value
    ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
    : '—';
function text(id, value) {
  $(id).textContent = value;
}
function notice(message, error = false) {
  text('notice', message);
  $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}
function rememberGuildSelection() {
  const selected = $('guild').value;
  if (!current || !guilds.some(guild => guild.id === selected)) return;
  try { localStorage.setItem(`picket-server:${current.user.id}`, selected); } catch {}
}
function restoreGuildSelection() {
  let saved = null;
  try { saved = localStorage.getItem(`picket-server:${current.user.id}`); } catch {}
  $('guild').value = guilds.some(guild => guild.id === saved) ? saved : guilds[0]?.id ?? '';
  rememberGuildSelection();
}
let guildNamesUpdatedAt = 0;
function updateGuilds(data) {
  for (const guild of data.guilds) {
    if (guild.level === 'unknown') guild.level = guilds.find(previous => previous.id === guild.id)?.level ?? 'member';
  }
  guilds = data.guilds.sort((a, b) => Number(!!a.inactive) - Number(!!b.inactive)
    || Number(a.nameKnown === false) - Number(b.nameKnown === false) || a.name.localeCompare(b.name, language));
  const previous = $('guild').value;
  renderGuildOptions();
  if (previous !== 'all' && !guilds.some(guild => guild.id === previous)) restoreGuildSelection();
  guildNamesUpdatedAt = Date.now();
}
function renderGuildOptions() {
  const select = $('guild');
  const previous = select.value;
  const includeAll = !!select.querySelector('option[value="all"]');
  const options = (items) => items.map(guild => {
    const name = guild.nameKnown === false ? `${t('unknownServer')} (${guild.id})` : guild.name;
    const option = new Option(guild.inactive ? `${name} — ${t('inactiveServer')}` : name, guild.id);
    option.classList.toggle('inactive-server', !!guild.inactive);
    return option;
  });
  const active = guilds.filter(guild => !guild.inactive);
  const inactive = guilds.filter(guild => guild.inactive);
  if (inactive.length) {
    select.replaceChildren();
    for (const [items, key] of [[active, 'activeServerGroup'], [inactive, 'inactiveServerGroup']]) {
      if (!items.length) continue;
      const group = document.createElement('optgroup');
      group.label = t(key);
      group.append(...options(items));
      select.append(group);
    }
  } else select.replaceChildren(...options(active));
  if (includeAll) select.prepend(new Option(t('allServers'), 'all'));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function translate() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((node) => (node.textContent = t(node.dataset.i18n)));
  document.querySelectorAll('[data-i18n-label]').forEach((node) => node.setAttribute('aria-label', t(node.dataset.i18nLabel)));
  document.querySelectorAll('[data-doc-path]').forEach((node) => {
    node.href = `https://docs.picket-foxhole.com${language === 'fr' ? '/fr' : ''}${node.dataset.docPath}`;
  });
  $('language').value = language;
  $('theme').value = theme;
  document.documentElement.dataset.theme = theme;
  document.title = `PICKET · ${current ? t(page) : t('signIn')}`;
  if (startupFailure) text('startup-error', errorText(startupFailure));
  if (current) {
    renderGuildOptions();
    setHeading();
    renderPrivacyStatus();
    if (page === 'picket' && instanceReport) renderInstance(instanceReport);
    else if (report) render(report);
    if (loadFailure) renderLoadFailure();
  }
}
async function api(path, options = {}) {
  if (retryFailure && Date.now() >= retryAt) {
    retryFailure = null;
    updateRetryState();
  }
  if (retryFailure && Date.now() < retryAt && path !== '/api/logout' &&
    (retryFailure.message === 'rate_limited' || /^\/api\/(guilds|activity|privacy(?:\?|$)|export)/.test(path))) throw retryFailure;
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json', 'x-picket-csrf': current?.csrf ?? '' } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let body = {};
    try {
      body = await response.json();
    } catch {}
    const error = Object.assign(new Error(body.error ?? 'unavailable'), {
      status: response.status, retryAfter: Number(response.headers.get('Retry-After')),
    });
    if (['discord_rate_limited', 'rate_limited'].includes(error.message)) {
      retryAt = Math.max(retryAt, Date.now() + Math.max(1, error.retryAfter || 60) * 1000);
      error.retryAt = retryAt;
      retryFailure = error;
      updateRetryState();
    }
    if (error.status === 401 && current) endSession();
    if (error.status === 403 && path.startsWith('/api/export')) {
      const guildId = new URLSearchParams(path.split('?')[1]).get('guild');
      privacyCache.delete(guildId);
      if (guildId === $('guild').value) {
        generation++;
        loading = false;
        clearReport();
        $('workspace').removeAttribute('aria-busy');
        text('updated', t('loadFailed'));
      }
    }
    throw error;
  }
  return response;
}
function errorText(error) {
  if (error.message === 'stats_snapshot_pending') return t('snapshotPending');
  if (['discord_rate_limited', 'rate_limited'].includes(error.message))
    return t(error.message === 'rate_limited' ? 'dashboardRateLimited' : 'discordRateLimited')
      .replace('{seconds}', number(Math.max(0, error.retryAt ? Math.ceil((error.retryAt - Date.now()) / 1000) : error.retryAfter || 60)));
  if (error.message === 'discord_unavailable') return t('discordUnavailable');
  return error.status === 403
    ? t('forbidden')
    : error.message === 'invalid_period'
      ? t('invalidPeriod')
      : error.message === 'export_too_large'
        ? t('exportTooLarge')
        : error.status === 401
          ? t('sessionExpired')
          : t('error');
}
function renderPrivacyStatus() {
  $('privacy-status').hidden = !privacyFailure;
  if (privacyFailure) text('privacy-status', privacyFailure.message === 'discord_rate_limited'
    ? errorText(privacyFailure) : t('privacyUnavailable'));
}
function updateRetryState() {
  const waiting = Date.now() < retryAt;
  for (const id of ['refresh', 'export-csv', 'export-json', 'startup-retry']) $(id).disabled = waiting;
  $('instance-refresh').disabled = waiting && retryFailure?.message === 'rate_limited';
  if (waiting) for (const id of ['opt-out', 'save-privacy', 'erase']) $(id).disabled = true;
}
function clearReport() {
  report = null;
  instanceReport = null;
  displayedReportKey = null;
  ['metric-hours', 'metric-users', 'metric-sessions', 'metric-live', 'instance-total'].forEach(id => text(id, '—'));
  for (const id of ['daily-chart', 'people-daily-chart', 'hourly-chart', 'server-summary-body',
    'channels-chart', 'people-body', 'segments-body', 'instance-features', 'instance-adoption', 'guild-feature-states']) $(id).replaceChildren();
  $('guild-features').hidden = true;
  $('empty').hidden = true;
}
function renderLoadFailure() {
  notice(errorText(loadFailure), true);
  text(page === 'picket' ? 'instance-updated' : 'updated', t(displayedReportKey ? 'staleData' : 'loadFailed'));
}
function endSession() {
  current = null;
  generation++;
  loading = false;
  loadFailure = null;
  retryFailure = null;
  retryAt = 0;
  privacyCache.clear();
  clearReport();
  $('workspace').hidden = true;
  $('workspace').removeAttribute('aria-busy');
  $('welcome').hidden = false;
  $('logout').hidden = true;
  $('erase-all').hidden = true;
  $('login-status').hidden = false;
  updateRetryState();
}
function setHeading() {
  const isOverview = page === 'overview' || page === 'picket';
  text('greeting', `${t('hello')} · ${current.user.name}`);
  text('page-title', t(isOverview ? 'overview' : page));
  text('page-description', t(`${page}Description`));
  document.title = `PICKET · ${t(isOverview ? 'overview' : page)}`;
  $('overview-tabs').hidden = !isOverview;
  document.querySelectorAll('[data-overview-page]').forEach((tab) => {
    const selected = tab.dataset.overviewPage === page;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $('overview-tab-server').disabled = guilds.length === 0;
  $('overview-tab-server').title = guilds.length ? '' : t('noGuilds');
  if (isOverview) {
    $('voice-content').setAttribute('role','tabpanel');
    $('voice-content').setAttribute('aria-labelledby','overview-tab-server');
    $('voice-content').tabIndex = 0;
  } else {
    for (const attribute of ['role','aria-labelledby','tabindex']) $('voice-content').removeAttribute(attribute);
  }
  $('instance-overview').hidden = page !== 'picket';
  $('voice-content').hidden = page === 'picket';
  if (page === 'picket') text('scope-badge', t('scopeShared'));
  if (page === 'overview') text('scope-badge', t('scopeOverview'));
  $('admin-card').hidden = page !== 'admin';
  $('guild-features').hidden = page !== 'admin' || !current.administrator || !report?.guildFeatures || $('guild').value === 'all';
  $('people-card').hidden = page === 'overview';
  $('segments-card').hidden = page === 'overview';
  $('privacy-card').hidden = page === 'admin' || $('guild').value === 'all';
  const selected = guilds.find((g) => g.id === $('guild').value);
  $('guild').classList.toggle('has-inactive-selection', !!selected?.inactive);
  $('guild-status').hidden = !selected?.inactive;
  text('guild-status', t('inactiveServer'));
  if (selected?.isMember === false) $('privacy-card').hidden = true;
  const privileged = ['officer', 'admin', 'instance_admin'].includes(selected?.level);
  $('access-field').hidden = page !== 'activity' || !privileged;
  document.querySelectorAll('[data-page]').forEach((node) => {
    const selected = node.dataset.page === page || (node.dataset.page === 'overview' && isOverview);
    node.classList.toggle('active', selected);
    node.setAttribute('aria-current', selected ? 'page' : 'false');
  });
}
function renderInstance(data) {
  instanceReport = data;
  text('instance-total', number(data.activeGuilds));
  text('instance-updated', `${t('updated')} · ${date(data.updatedAt)}`);
  $('instance-features').replaceChildren();
  $('instance-adoption').replaceChildren();
  for (const row of data.features) {
    const share = data.activeGuilds ? row.enabledGuilds / data.activeGuilds : 0;
    const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 }).format(share);
    const card = document.createElement('article'); card.className = 'metric'; card.dataset.feature = row.feature;
    const name = document.createElement('span'), count = document.createElement('strong'), helper = document.createElement('small');
    name.textContent = t(featureLabels[row.feature]); count.textContent = number(row.enabledGuilds);
    helper.textContent = `${percent} · ${t('enabledServers')}`;
    card.append(name, count, helper); $('instance-features').append(card);
    const item = document.createElement('div'); item.className = 'channel-row';
    const caption = document.createElement('div'); caption.className = 'channel-caption';
    const label = document.createElement('span'), value = document.createElement('strong');
    label.textContent = t(featureLabels[row.feature]); value.textContent = `${number(row.enabledGuilds)} / ${number(data.activeGuilds)} · ${percent}`;
    caption.append(label, value);
    const track = document.createElement('div'); track.className = 'bar-track';
    const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.width = `${share * 100}%`;
    track.append(fill); item.append(caption, track); $('instance-adoption').append(item);
  }
}
function query() {
  const selected = $('guild').value;
  const mode =
    page === 'overview'
      ? 'overview'
      : page === 'admin'
        ? 'guild'
        : $('access-field').hidden
          ? 'personal'
          : $('access').value;
  const params = new URLSearchParams({
    guild: selected,
    days: $('period').value,
    mode,
    offset: String(offset),
  });
  if ($('channel').value) params.set('channel', $('channel').value);
  return params;
}
function svgNode(tag, attrs = {}, content) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
}
function dailyChart(rows) {
  const host = $('daily-chart');
  host.replaceChildren();
  const svg = svgNode('svg', { viewBox: '0 0 650 235', role: 'img', 'aria-label': t('chartDescription') });
  host.setAttribute(
    'aria-label',
    `${t('chartDescription')}: ${rows.map((row) => `${row.day}: ${number(row.seconds / 3600, 2)} h`).join('; ')}`,
  );
  const max = Math.max(1, ...rows.map((r) => r.seconds / 3600));
  const top = Math.ceil(max * 1.15);
  const width = 570;
  const slot = width / Math.max(1, rows.length);
  for (let i = 0; i < 4; i++) {
    const y = 190 - i * 55;
    svg.append(
      svgNode('line', { x1: 42, y1: y, x2: 630, y2: y, class: 'gridline' }),
      svgNode('text', { x: 33, y: y + 3, 'text-anchor': 'end', class: 'axis' }, number((top * i) / 3, 1)),
    );
  }
  rows.forEach((row, i) => {
    const h = (row.seconds / 3600 / top) * 165;
    const rect = svgNode('rect', {
      x: 49 + i * slot,
      y: 190 - h,
      width: Math.max(2, slot * 0.65),
      height: Math.max(0, h),
      rx: Math.min(3, slot * 0.1),
      class: 'bar',
    });
    rect.append(
      svgNode(
        'title',
        {},
        `${row.day} · ${number(row.seconds / 3600, 2)} ${t('hours')} · ${number(row.users)} ${t('activePeople').toLowerCase()}`,
      ),
    );
    svg.append(rect);
    if (i % Math.max(1, Math.ceil(rows.length / 7)) === 0 || i === rows.length - 1)
      svg.append(
        svgNode(
          'text',
          { x: 49 + i * slot, y: 218, class: 'axis' },
          new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
            new Date(`${row.day}T12:00:00Z`),
          ),
        ),
      );
  });
  host.append(svg);
}

function serverRows(data) {
  const reported = new Map((data.serverActivity ?? []).map((row) => [row.guildId, row]));
  const visible = data.scope === 'global' ? guilds : guilds.filter((g) => g.id === $('guild').value);
  return visible.map((g) => ({ guildId: g.id, name: g.name, seconds: 0, activeUsers: 0, sessions: 0,
    inVoice: 0, daily: [], ...reported.get(g.id) })).sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
}

function seriesChart(hostId, data, rows, metric) {
  const host = $(hostId);
  host.replaceChildren();
  const days = data.daily.map((day) => day.day);
  const colors = ['var(--blue)', 'var(--green)', 'var(--amber)', 'var(--danger)', 'var(--muted)'];
  const series = rows.map((row, index) => {
    const values = new Map(row.daily.map((day) => [day.day, day[metric]]));
    return { id: row.guildId, name: row.name, color: colors[index % colors.length],
      values: days.map((day) => (values.get(day) ?? 0) / (metric === 'seconds' ? 3600 : 1)) };
  });
  if (metric === 'users' && data.scope === 'global') series.push({ id: 'unique', name: t('uniquePeopleAllServers'),
    color: 'var(--text)', values: data.daily.map((day) => day.users), dashed: true });
  if (!series.length || !days.length) { host.textContent = t('emptyTitle'); return; }
  const left = 46, width = 582, bottom = 190, height = 165;
  const sums = days.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  const peak = metric === 'seconds' ? Math.max(1, ...sums) : Math.max(1, ...series.flatMap((s) => s.values));
  const step = Math.max(metric === 'users' ? 1 : 0.25, Math.ceil(peak / 4));
  const top = step * 4;
  const x = (i) => left + (days.length === 1 ? width / 2 : i * width / (days.length - 1));
  const y = (value) => bottom - value / top * height;
  const svg = svgNode('svg', { viewBox: '0 0 650 235', role: 'img', tabindex: '0',
    'aria-label': t(metric === 'seconds' ? 'serverVoiceTitle' : 'peopleDailyTitle') });
  for (let tick = 0; tick <= 4; tick++) {
    const value = tick * step;
    svg.append(svgNode('line', { x1: left, y1: y(value), x2: left + width, y2: y(value), class: 'gridline' }),
      svgNode('text', { x: left - 9, y: y(value) + 3, 'text-anchor': 'end', class: 'axis' }, number(value, metric === 'seconds' ? 1 : 0)));
  }
  let accumulated = days.map(() => 0);
  for (const s of series) {
    let path;
    if (metric === 'seconds') {
      const lower = accumulated;
      accumulated = lower.map((value, i) => value + s.values[i]);
      const points = accumulated.map((value, i) => `${i ? 'L' : 'M'}${x(i)},${y(value)}`);
      for (let i = lower.length - 1; i >= 0; i--) points.push(`L${x(i)},${y(lower[i])}`);
      const shape = days.length === 1
        ? `M${x(0) - 24},${y(accumulated[0])} H${x(0) + 24} V${y(lower[0])} H${x(0) - 24} Z`
        : points.join(' ') + ' Z';
      path = svgNode('path', { d: shape, fill: s.color, 'fill-opacity': 0.76,
        stroke: s.color, 'stroke-width': 1, 'data-series': s.id, class: 'server-series' });
    } else {
      path = svgNode('path', { d: s.values.map((value, i) => `${i ? 'L' : 'M'}${x(i)},${y(value)}`).join(' '),
        fill: 'none', stroke: s.color, 'stroke-width': s.dashed ? 3 : 2,
        ...(s.dashed ? { 'stroke-dasharray': '6 4' } : {}), 'data-series': s.id, class: 'server-series' });
    }
    path.append(svgNode('title', {}, s.name));
    svg.append(path);
    if (metric === 'users' && days.length === 1) {
      const marker = svgNode('circle', { cx: x(0), cy: y(s.values[0]), r: 4, fill: s.color, 'data-series': s.id });
      marker.append(svgNode('title', {}, s.name)); svg.append(marker);
    }
  }
  days.forEach((day, i) => {
    if (i % Math.max(1, Math.ceil(days.length / 7)) === 0 || i === days.length - 1) {
      svg.append(svgNode('text', { x: x(i), y: 218, 'text-anchor': i === days.length - 1 ? 'end' : 'start', class: 'axis' },
        new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))));
    }
  });
  const legend = document.createElement('div');
  legend.className = 'series-legend';
  legend.tabIndex = 0;
  for (const s of series) {
    const item = document.createElement('span'), swatch = document.createElement('i');
    swatch.style.backgroundColor = s.color;
    item.append(swatch, document.createTextNode(s.name)); legend.append(item);
  }
  const tooltip = document.createElement('div');
  tooltip.className = 'series-tooltip'; tooltip.hidden = true; tooltip.setAttribute('role', 'status');
  let point = 0;
  function showPoint(index, focused, keyboard = false) {
    point = Math.max(0, Math.min(days.length - 1, index));
    const candidates = [...series].sort((a, b) => b.values[point] - a.values[point]);
    const hovered = candidates.find((s) => s.id === focused);
    const visible = hovered ? [hovered, ...candidates.filter((s) => s !== hovered)].slice(0, 8) : candidates.slice(0, 8);
    const lines = [days[point], ...visible.map((s) => `${s.name}: ${number(s.values[point], metric === 'seconds' ? 2 : 0)}${metric === 'seconds' ? ' h' : ''}`)];
    if (candidates.length > visible.length) lines.push(`+${candidates.length - visible.length} ${t('otherSeries')}`);
    tooltip.textContent = lines.join('\n'); tooltip.hidden = false;
    tooltip.setAttribute('aria-live', keyboard ? 'polite' : 'off');
  }
  svg.addEventListener('pointermove', (event) => {
    const bounds = svg.getBoundingClientRect();
    showPoint(Math.round(((event.clientX - bounds.left) / bounds.width * 650 - left) / width * (days.length - 1)), event.target.dataset?.series);
  });
  svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  svg.addEventListener('blur', () => { tooltip.hidden = true; });
  svg.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      showPoint(event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : point + (event.key === 'ArrowRight' ? 1 : -1), undefined, true);
    }
  });
  host.append(svg, legend, tooltip);
}
function channelChart(rows) {
  const host = $('channels-chart');
  host.replaceChildren();
  if (!rows.length) {
    host.textContent = t('noChannels');
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  rows.slice(0, 8).forEach((row) => {
    const item = document.createElement('div');
    item.className = 'channel-row';
    const caption = document.createElement('div');
    caption.className = 'channel-caption';
    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = row.name;
    name.title = row.name;
    const value = document.createElement('strong');
    value.textContent = `${number(row.seconds / 3600, 1)} h`;
    caption.append(name, value);
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${(row.seconds / max) * 100}%`;
    track.append(fill);
    item.append(caption, track);
    host.append(item);
  });
}
function renderGuildFeatures(features) {
  const host = $('guild-feature-states');
  host.replaceChildren();
  $('guild-features').hidden = page !== 'admin' || !current.administrator || !features || $('guild').value === 'all';
  if ($('guild-features').hidden) return;
  for (const row of features) {
    const card = document.createElement('article'); card.className = 'metric';
    card.dataset.feature = row.feature; card.dataset.enabled = String(row.enabled);
    const name = document.createElement('span'), state = document.createElement('strong');
    name.textContent = t(featureLabels[row.feature]);
    state.textContent = t(row.enabled ? 'featureEnabled' : 'featureDisabled');
    card.append(name, state); host.append(card);
  }
}
function render(data) {
  report = data;
  renderGuildFeatures(data.guildFeatures);
  text('metric-hours', number(data.seconds / 3600, 1));
  text('metric-users', number(data.activeUsers));
  text('metric-users-help', t(data.scope === 'global' ? 'globalUniquePeopleHelp' : 'activePeopleHelp'));
  text('metric-sessions', number(data.sessions));
  text('metric-live', number(data.inVoice));
  text(
    'scope-badge',
    t(
      data.scope === 'overview'
        ? 'scopeOverview'
        : data.scope === 'self'
          ? 'scopeSelf'
          : data.scope === 'global'
            ? 'scopeGlobal'
            : 'scopeGuild',
    ),
  );
  text('updated', data.updatedAt ? `${t(data.snapshotAt ? 'snapshotAsOf' : 'updated')} · ${date(data.updatedAt)}` : t('notUpdated'));
  text('metric-live-title', t(data.snapshotAt ? 'snapshotVoice' : 'inVoice'));
  text('metric-live-help', t(data.snapshotAt ? 'snapshotVoiceHelp' : 'inVoiceHelp'));
  text('server-summary-live', t(data.snapshotAt ? 'snapshotVoice' : 'inVoice'));
  text('timezone', `${t('timezone')} ${data.timezone}`);
  $('empty').hidden = data.seconds > 0 || data.inVoice > 0;
  const servers = serverRows(data);
  text('daily-title', t(data.scope === 'global' ? 'serverVoiceTitle' : 'dailyTitle'));
  text('daily-help', t(data.scope === 'global' ? 'serverVoiceHelp' : 'dailyHelp'));
  if (data.scope === 'global') seriesChart('daily-chart', data, servers, 'seconds');
  else dailyChart(data.daily);
  const personalDays = servers.map((row) => ({ ...row, daily: data.scope !== 'global' ? data.daily : row.daily }));
  seriesChart('people-daily-chart', data, personalDays, 'users');
  text('people-daily-help', t(data.scope === 'global' ? 'peopleDailyGlobalHelp' : 'peopleDailyHelp'));
  $('server-summary').hidden = !['global', 'guild'].includes(data.scope);
  $('server-summary-body').replaceChildren();
  for (const row of servers) {
    const tr = document.createElement('tr');
    for (const value of [row.name, number(row.activeUsers), `${number(row.seconds / 3600, 2)} h`, number(row.sessions), number(row.inVoice)]) {
      const cell = document.createElement('td'); cell.textContent = value; tr.append(cell);
    }
    $('server-summary-body').append(tr);
  }
  channelChart(data.channels);
  const selectedChannel = $('channel').value;
  if (!selectedChannel)
    $('channel').replaceChildren(
      new Option(t('allChannels'), ''),
      ...data.channels.map((row) => new Option(row.name, row.id)),
    );
  text('peak', `${t('peak')} · ${number(data.peakConcurrency)}`);
  const hourly = data.hourly.map((row) => ({ day: `${row.hour}:00`, seconds: row.seconds, users: 0 }));
  const host = $('hourly-chart');
  host.replaceChildren();
  const max = Math.max(1, ...hourly.map((row) => row.seconds));
  const svg = svgNode('svg', { viewBox: '0 0 650 235', role: 'img', 'aria-label': t('hourlyHelp') });
  for (let hour = 0; hour < 24; hour++) {
    const seconds = data.hourly.find((row) => row.hour === hour)?.seconds ?? 0;
    const height = (seconds / max) * 165;
    const bar = svgNode('rect', {
      x: 40 + hour * 24,
      y: 190 - height,
      width: 15,
      height,
      rx: 3,
      class: 'bar',
    });
    bar.append(svgNode('title', {}, `${hour}:00 · ${number(seconds / 3600, 2)} h`));
    svg.append(bar);
    if (hour % 3 === 0) svg.append(svgNode('text', { x: 40 + hour * 24, y: 218, class: 'axis' }, `${hour}h`));
  }
  host.append(svg);
  $('next').disabled = !data.truncated;
  $('previous').disabled = offset === 0;
  text('page-number', String(1 + offset / 1000));
  text('people-title', t(data.scope === 'self' ? 'myTitle' : 'peopleTitle'));
  text('people-description', t(data.scope === 'self' ? 'myDescription' : 'peopleDescription'));
  $('people-body').replaceChildren();
  for (const row of data.users) {
    const tr = document.createElement('tr');
    for (const value of [
      row.name,
      guilds.find((g) => g.id === row.guildId)?.name ?? row.guildId,
      `${number(row.seconds / 3600, 2)} h`,
      number(row.sessions),
      date(row.lastActivity),
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      tr.append(cell);
    }
    $('people-body').append(tr);
  }
  $('segments-body').replaceChildren();
  for (const row of data.recent ?? []) {
    const tr = document.createElement('tr');
    for (const value of [
      row.name,
      row.channel,
      date(row.startedAt),
      date(row.endedAt ?? row.confirmedThrough),
      `${number(row.seconds / 60, 1)} min`,
      t(row.quality),
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      tr.append(cell);
    }
    $('segments-body').append(tr);
  }
  $('truncated').hidden = !data.truncated;
  const selected = guilds.find((g) => g.id === $('guild').value);
  const warnings = [];
  if (selected?.inactive) warnings.push(t('inactiveHelp'));
  else if (selected && !selected.enabled) warnings.push(t('paused'));
  if (data.interruptedSegments > 0) warnings.push(t('gap'));
  if (!data.snapshotAt && data.updatedAt && Date.now() - Date.parse(data.updatedAt) > 180000 && selected?.enabled)
    warnings.push(t('late'));
  notice(warnings.join(' '));
}
async function load({ refreshPrivacy = false } = {}) {
  if (!current || (page !== 'picket' && !$('guild').value)) return;
  const ticket = ++generation;
  loading = true;
  setHeading();
  let requestedKey = page === 'picket' ? 'picket' : `${page}:${query()}`;
  if (displayedReportKey !== requestedKey) clearReport();
  loadFailure = null;
  $('workspace').setAttribute('aria-busy', 'true');
  text('updated', t('loading'));
  notice('');
  for (const id of ['opt-out', 'save-privacy', 'erase']) $(id).disabled = true;
  $('opt-out').checked = false;
  privacyFailure = null;
  renderPrivacyStatus();
  try {
    if (Date.now() - guildNamesUpdatedAt >= 300000 && Date.now() >= retryAt) {
      try {
        const names = await (await api('/api/guilds')).json();
        if (ticket !== generation) return;
        updateGuilds(names);
        setHeading();
        requestedKey = page === 'picket' ? 'picket' : `${page}:${query()}`;
        if (displayedReportKey !== requestedKey) clearReport();
      } catch (error) {
        if (error.status === 401) throw error;
        // Optional label refresh must not prevent loading activity or checking access.
      }
    }
    if (page === 'picket') {
      text('instance-updated', t('loading'));
      const data = await (await api('/api/instance')).json();
      if (ticket === generation) {
        displayedReportKey = requestedKey;
        renderInstance(data);
      }
      return;
    }
    const data = await (await api(`/api/activity?${query()}`)).json();
    if (ticket !== generation) return;
    const selectedGuild = guilds.find(guild => guild.id === $('guild').value);
    if (selectedGuild && data.accessLevel) {
      selectedGuild.level = data.accessLevel;
      setHeading();
    }
    displayedReportKey = `${page}:${query()}`;
    render(data);
    if (
      page !== 'admin' &&
      $('guild').value !== 'all' &&
      guilds.find((g) => g.id === $('guild').value)?.isMember !== false
    ) {
      try {
        const guildId = $('guild').value;
        const cached = privacyCache.get(guildId);
        const privacy = !refreshPrivacy && cached && Date.now() - cached.at < 300000
          ? cached.value : await (await api(`/api/privacy?guild=${guildId}`)).json();
        if (ticket === generation) {
          if (privacy !== cached?.value) privacyCache.set(guildId, { at: Date.now(), value: privacy });
          $('opt-out').checked = privacy.optedOut;
          for (const id of ['opt-out', 'save-privacy', 'erase']) $(id).disabled = Date.now() < retryAt;
        }
      } catch (error) {
        if (error.status === 401) throw error;
        if (ticket === generation) {
          privacyCache.delete($('guild').value);
          privacyFailure = error;
          renderPrivacyStatus();
          $('privacy-card').open = true;
        }
      }
    }
    if (page === 'admin') {
      const state = await (await api('/api/admin/status')).json();
      if (ticket !== generation) return;
      const host = $('buffer-status');
      host.replaceChildren();
      for (const [label, value] of [
        ['bufferRecords', number(state.buffer.count)],
        ['bufferSize', `${number(state.buffer.bytes / 1024 / 1024, 2)} MiB`],
        ['bufferOldest', state.buffer.oldest ? date(state.buffer.oldest) : t('bufferEmpty')],
      ]) {
        const item = document.createElement('div');
        item.textContent = t(label);
        const strong = document.createElement('strong');
        strong.textContent = value;
        item.append(strong);
        host.append(item);
      }
    }
  } catch (error) {
    if (ticket === generation) {
      if (error.status === 401) {
        endSession();
      } else {
        if (error.status === 403) {
          clearReport();
          privacyCache.delete($('guild').value);
        }
        loadFailure = error;
        renderLoadFailure();
      }
    }
  } finally {
    if (ticket === generation) {
      loading = false;
      $('workspace').removeAttribute('aria-busy');
    }
  }
}
function choosePage(next) {
  const previousGuild = $('guild').value;
  offset = 0;
  page = next;
  if (next === 'overview' || next === 'picket') overviewPage = next;
  if (
    next === 'admin' &&
    current.administrator &&
    !Array.from($('guild').options).some((o) => o.value === 'all')
  ) {
    $('guild').prepend(new Option(t('allServers'), 'all'));
    $('guild').value = 'all';
  } else if (next !== 'admin') {
    const all = $('guild').querySelector('option[value="all"]');
    if (all) {
      all.remove();
      restoreGuildSelection();
    }
  }
  if (previousGuild !== $('guild').value) $('channel').replaceChildren(new Option(t('allChannels'),''));
  setHeading();
  load();
}
$('language').addEventListener('change', (event) => {
  language = event.target.value;
  localStorage.setItem('picket-language', language);
  translate();
  const all = $('guild').querySelector('option[value="all"]');
  if (all) all.textContent = t('allServers');
});
$('theme').addEventListener('change', (event) => {
  theme = event.target.value;
  localStorage.setItem('picket-theme', theme);
  document.documentElement.dataset.theme = theme;
});
document
  .querySelectorAll('[data-page]')
  .forEach((button) => button.addEventListener('click', () => choosePage(button.dataset.page === 'overview' ? overviewPage : button.dataset.page)));
document.querySelectorAll('[data-overview-page]').forEach((tab) => {
  tab.addEventListener('click', () => choosePage(tab.dataset.overviewPage));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(document.querySelectorAll('[data-overview-page]')).filter((item) => !item.disabled);
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs.forEach((item, position) => { item.tabIndex = position === next ? 0 : -1; });
    tabs[next].focus();
  });
});
for (const id of ['guild', 'period', 'access', 'channel'])
  $(id).addEventListener('change', () => {
    offset = 0;
    if (id === 'guild') {
      rememberGuildSelection();
      $('channel').replaceChildren(new Option(t('allChannels'), ''));
    }
    load();
  });
$('next').addEventListener('click', () => {
  offset += 1000;
  load();
});
$('previous').addEventListener('click', () => {
  offset = Math.max(0, offset - 1000);
  load();
});
$('refresh').addEventListener('click', () => load({ refreshPrivacy: true }));
$('instance-refresh').addEventListener('click', () => load());
$('logout').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
    location.reload();
  } catch (error) {
    notice(errorText(error), true);
  }
});
for (const format of ['csv', 'json'])
  $(`export-${format}`).addEventListener('click', async () => {
    try {
      const params = query();
      params.set('format', format);
      const response = await api(`/api/export?${params}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `picket-voice-${$('guild').value}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      notice(errorText(error), true);
    }
  });
$('save-privacy').addEventListener('click', async () => {
  try {
    const guildId = $('guild').value;
    await api('/api/privacy', {
      method: 'POST',
      body: JSON.stringify({ guild: guildId, optedOut: $('opt-out').checked, erase: false }),
    });
    privacyCache.delete(guildId);
    await load();
    notice(t('saved'));
  } catch (error) {
    notice(errorText(error), true);
  }
});
function openErase(all) {
  eraseAll = all;
  text('erase-description', t(all ? 'eraseAllHelp' : 'eraseHelp'));
  $('erase-confirm').value = '';
  $('erase-submit').disabled = true;
  $('erase-dialog').showModal();
  $('erase-confirm').focus();
}
$('erase').addEventListener('click', () => openErase(false));
$('erase-all').addEventListener('click', () => openErase(true));
$('erase-confirm').addEventListener('input', () => {
  $('erase-submit').disabled = $('erase-confirm').value !== 'DELETE';
});
$('erase-cancel').addEventListener('click', () => $('erase-dialog').close());
$('erase-submit').addEventListener('click', async () => {
  if ($('erase-confirm').value !== 'DELETE') return;
  $('erase-submit').disabled = true;
  try {
    await api(eraseAll ? '/api/privacy/erase-all' : '/api/privacy', {
      method: 'POST',
      body: JSON.stringify(
        eraseAll
          ? { confirm: 'DELETE' }
          : { guild: $('guild').value, optedOut: $('opt-out').checked, erase: true, confirm: 'DELETE' },
      ),
    });
    privacyCache.clear();
    $('erase-dialog').close();
    await load();
    notice(t('erased'));
  } catch (error) {
    $('erase-dialog').close();
    notice(errorText(error), true);
  }
});
async function initialize() {
  startupFailure = null;
  $('main').setAttribute('aria-busy', 'true');
  $('workspace').hidden = false;
  $('workspace').setAttribute('inert', '');
  $('workspace').setAttribute('aria-hidden', 'true');
  $('startup').hidden = false;
  $('startup-message').hidden = false;
  $('startup-error').hidden = true;
  $('startup-retry').hidden = true;
  try {
    const activeSession = await (await api('/api/session')).json();
    const data = await (await api('/api/guilds')).json();
    current = activeSession;
    updateGuilds(data);
    restoreGuildSelection();
    $('welcome').hidden = true;
    $('workspace').hidden = false;
    $('logout').hidden = false;
    $('erase-all').hidden = false;
    $('admin-nav').hidden = !current.administrator;
    setHeading();
    if (!guilds.length) {
      page = 'picket';
      overviewPage = 'picket';
    }
    await load();
    $('startup').hidden = true;
    $('workspace').removeAttribute('inert');
    $('workspace').removeAttribute('aria-hidden');
  } catch (error) {
    current = null;
    if (error.status === 401) {
      $('startup').hidden = true;
      $('workspace').hidden = true;
      $('welcome').hidden = false;
    } else {
      startupFailure = error;
      $('startup-message').hidden = true;
      text('startup-error', errorText(error));
      $('startup-error').hidden = false;
      $('startup-retry').hidden = false;
    }
  } finally {
    $('main').removeAttribute('aria-busy');
  }
}
$('startup-retry').addEventListener('click', () => initialize());
translate();
await initialize();
setInterval(() => {
  if (!document.hidden && !loading && current && Date.now() >= retryAt) load();
}, 60000);
setInterval(() => {
  if (!retryFailure) return;
  updateRetryState();
  if (loadFailure) renderLoadFailure();
  if (privacyFailure) renderPrivacyStatus();
  if (startupFailure) text('startup-error', errorText(startupFailure));
  if (Date.now() >= retryAt && !document.hidden && !loading) {
    retryFailure = null;
    if (current) load();
    else if (startupFailure) initialize();
  }
}, 1000);
