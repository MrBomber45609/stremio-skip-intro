// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const debounce = require('lodash.debounce');
const langs = require('langs');
const { useTranslation } = require('react-i18next');
const { useRouteFocused } = require('stremio-router');
const { useServices } = require('stremio/services');
const { onFileDrop, useSettings, useProfile, useFullscreen, useBinaryState, useToast, useStreamingServer, withCoreSuspender, CONSTANTS, useShell, usePlatform, onShortcut } = require('stremio/common');
const { HorizontalNavBar, Transition, ContextMenu } = require('stremio/components');
const BufferingLoader = require('./BufferingLoader');
const VolumeChangeIndicator = require('./VolumeChangeIndicator');
const Error = require('./Error');
const ControlBar = require('./ControlBar');
const NextVideoPopup = require('./NextVideoPopup');
const StatisticsMenu = require('./StatisticsMenu');
const OptionsMenu = require('./OptionsMenu');
const SubtitlesMenu = require('./SubtitlesMenu');
const { default: AudioMenu } = require('./AudioMenu');
const SpeedMenu = require('./SpeedMenu');
const { default: SideDrawerButton } = require('./SideDrawerButton');
const { default: SideDrawer } = require('./SideDrawer');
const usePlayer = require('./usePlayer');
const useStatistics = require('./useStatistics');
const useVideo = require('./useVideo');
const styles = require('./styles');
const Video = require('./Video');
const { default: Indicator } = require('./Indicator/Indicator');

const findTrackByLang = (tracks, lang) => tracks.find((track) => track.lang === lang || langs.where('1', track.lang)?.[2] === lang);
const findTrackById = (tracks, id) => tracks.find((track) => track.id === id);

const SKIP_INTRO_API_BASE = 'https://apistremio-skip-intro.org';
const getApiBaseUrl = () => (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) || SKIP_INTRO_API_BASE;
const skipIntroLog = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development'
    ? (...args) => console.log('[SKIP]', ...args)
    : () => {};
skipIntroLog.error = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development'
    ? (...args) => console.error('[SKIP]', ...args)
    : () => {};

const Player = ({ urlParams, queryParams }) => {
    const { t } = useTranslation();
    const services = useServices();
    const shell = useShell();
    const forceTranscoding = React.useMemo(() => {
        return queryParams.has('forceTranscoding');
    }, [queryParams]);
    const profile = useProfile();
    const [player, videoParamsChanged, streamStateChanged, timeChanged, seek, pausedChanged, ended, nextVideo] = usePlayer(urlParams);
    const [settings] = useSettings();
    const streamingServer = useStreamingServer();
    const statistics = useStatistics(player, streamingServer);
    const video = useVideo();
    const routeFocused = useRouteFocused();
    const platform = usePlatform();
    const toast = useToast();

    const [seeking, setSeeking] = React.useState(false);

    const [introData, setIntroData] = React.useState(null);
    const [creditsData, setCreditsData] = React.useState(null);
    const [showSkipButton, setShowSkipButton] = React.useState(false);
    const [showVerification, setShowVerification] = React.useState(false);
    const [activeSkipType, setActiveSkipType] = React.useState(null); // 'intro' | 'credits' — para saber qué se votó
    const [votedIntroId, setVotedIntroId] = React.useState(null);
    const [voteSent, setVoteSent] = React.useState(false); // Anti-spam: bloquea botones tras primer clic
    // Estados para marcar intros/créditos nuevas
    const [markingMode, setMarkingMode] = React.useState(false); // false | 'start' | 'end' | 'saving'
    const [markingType, setMarkingType] = React.useState('intro'); // 'intro' | 'credits'
    const [introStart, setIntroStart] = React.useState(null);

    const [casting, setCasting] = React.useState(() => {
        return services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED;
    });
    const playbackDevices = React.useMemo(() => streamingServer.playbackDevices !== null && streamingServer.playbackDevices.type === 'Ready' ? streamingServer.playbackDevices.content : [], [streamingServer]);

    const bufferingRef = React.useRef();
    const errorRef = React.useRef();

    const [immersed, setImmersed] = React.useState(true);
    const setImmersedDebounced = React.useCallback(debounce(setImmersed, 3000), []);
    const [, , , toggleFullscreen] = useFullscreen();

    const [optionsMenuOpen, , closeOptionsMenu, toggleOptionsMenu] = useBinaryState(false);
    const [subtitlesMenuOpen, , closeSubtitlesMenu, toggleSubtitlesMenu] = useBinaryState(false);
    const [audioMenuOpen, , closeAudioMenu, toggleAudioMenu] = useBinaryState(false);
    const [speedMenuOpen, , closeSpeedMenu, toggleSpeedMenu] = useBinaryState(false);
    const [statisticsMenuOpen, , closeStatisticsMenu, toggleStatisticsMenu] = useBinaryState(false);
    const [nextVideoPopupOpen, openNextVideoPopup, closeNextVideoPopup] = useBinaryState(false);
    const [sideDrawerOpen, , closeSideDrawer, toggleSideDrawer] = useBinaryState(false);

    const menusOpen = React.useMemo(() => {
        return optionsMenuOpen || subtitlesMenuOpen || audioMenuOpen || speedMenuOpen || statisticsMenuOpen || sideDrawerOpen;
    }, [optionsMenuOpen, subtitlesMenuOpen, audioMenuOpen, speedMenuOpen, statisticsMenuOpen, sideDrawerOpen]);

    const closeMenus = React.useCallback(() => {
        closeOptionsMenu();
        closeSubtitlesMenu();
        closeAudioMenu();
        closeSpeedMenu();
        closeStatisticsMenu();
        closeSideDrawer();
    }, []);

    const overlayHidden = React.useMemo(() => {
        return immersed && !casting && video.state.paused !== null && !video.state.paused && !menusOpen && !nextVideoPopupOpen;
    }, [immersed, casting, video.state.paused, menusOpen, nextVideoPopupOpen]);

    const nextVideoPopupDismissed = React.useRef(false);
    const creditsPopupShownRef = React.useRef(false);
    const defaultSubtitlesSelected = React.useRef(false);
    const subtitlesEnabled = React.useRef(true);
    const defaultAudioTrackSelected = React.useRef(false);
    const [error, setError] = React.useState(null);

    const isNavigating = React.useRef(false);

    const onImplementationChanged = React.useCallback(() => {
        video.setSubtitlesSize(settings.subtitlesSize);
        video.setSubtitlesOffset(settings.subtitlesOffset);
        video.setSubtitlesTextColor(settings.subtitlesTextColor);
        video.setSubtitlesBackgroundColor(settings.subtitlesBackgroundColor);
        video.setSubtitlesOutlineColor(settings.subtitlesOutlineColor);
    }, [settings]);

    const handleNextVideoNavigation = React.useCallback((deepLinks, bingeWatching, ended) => {
        if (ended) {
            if (bingeWatching) {
                if (deepLinks.player) {
                    isNavigating.current = true;
                    window.location.replace(deepLinks.player);
                } else if (deepLinks.metaDetailsStreams) {
                    isNavigating.current = true;
                    window.location.replace(deepLinks.metaDetailsStreams);
                }
            } else {
                window.history.back();
            }
        } else {
            if (deepLinks.player) {
                isNavigating.current = true;
                window.location.replace(deepLinks.player);
            } else if (deepLinks.metaDetailsStreams) {
                isNavigating.current = true;
                window.location.replace(deepLinks.metaDetailsStreams);
            }
        }
    }, []);

    const onEnded = React.useCallback(() => {
        if (isNavigating.current) {
            return;
        }

        ended();
        if (window.playerNextVideo !== null) {
            nextVideo();

            const deepLinks = window.playerNextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, profile.settings.bingeWatching, true);

        } else {
            window.history.back();
        }
    }, []);

    const onError = React.useCallback((error) => {
        console.error('Player', error);
        if (error.critical) {
            setError(error);
        } else {
            toast.show({
                type: 'error',
                title: t('ERROR'),
                message: error.message,
                timeout: 3000
            });
        }
    }, []);

    const onSubtitlesTrackLoaded = React.useCallback(() => {
        toast.show({
            type: 'success',
            title: t('PLAYER_SUBTITLES_LOADED'),
            message: t('PLAYER_SUBTITLES_LOADED_EMBEDDED'),
            timeout: 3000
        });
    }, []);

    const onExtraSubtitlesTrackLoaded = React.useCallback((track) => {
        toast.show({
            type: 'success',
            title: t('PLAYER_SUBTITLES_LOADED'),
            message:
                track.exclusive ? t('PLAYER_SUBTITLES_LOADED_EXCLUSIVE') :
                    track.local ? t('PLAYER_SUBTITLES_LOADED_LOCAL') :
                        t('PLAYER_SUBTITLES_LOADED_ORIGIN', { origin: track.origin }),
            timeout: 3000
        });
    }, []);

    const onExtraSubtitlesTrackAdded = React.useCallback((track) => {
        if (track.local) {
            video.setExtraSubtitlesTrack(track.id);
        }
    }, []);

    const onPlayRequested = React.useCallback(() => {
        video.setPaused(false);
        setSeeking(false);
    }, []);

    const onPlayRequestedDebounced = React.useCallback(debounce(onPlayRequested, 200), []);

    const onPauseRequested = React.useCallback(() => {
        video.setPaused(true);
    }, []);

    const onPauseRequestedDebounced = React.useCallback(debounce(onPauseRequested, 200), []);
    const onMuteRequested = React.useCallback(() => {
        video.setMuted(true);
    }, []);

    const onUnmuteRequested = React.useCallback(() => {
        video.setMuted(false);
    }, []);

    const onVolumeChangeRequested = React.useCallback((volume) => {
        video.setVolume(volume);
    }, []);

    const onSeekRequested = React.useCallback((time) => {
        video.setTime(time);
        seek(time, video.state.duration, video.state.manifest?.name);
    }, [video.state.duration, video.state.manifest]);

    const onPlaybackSpeedChanged = React.useCallback((rate) => {
        video.setPlaybackSpeed(rate);
    }, []);

    const onSubtitlesTrackSelected = React.useCallback((id) => {
        video.setSubtitlesTrack(id);
        streamStateChanged({
            subtitleTrack: {
                id,
                embedded: true,
            },
        });
    }, [streamStateChanged]);

    const onExtraSubtitlesTrackSelected = React.useCallback((id) => {
        video.setExtraSubtitlesTrack(id);
        streamStateChanged({
            subtitleTrack: {
                id,
                embedded: false,
            },
        });
    }, [streamStateChanged]);

    const onAudioTrackSelected = React.useCallback((id) => {
        video.setAudioTrack(id);
        streamStateChanged({
            audioTrack: {
                id,
            },
        });
    }, [streamStateChanged]);

    const onExtraSubtitlesDelayChanged = React.useCallback((delay) => {
        video.setSubtitlesDelay(delay);
        streamStateChanged({ subtitleDelay: delay });
    }, [streamStateChanged]);

    const onIncreaseSubtitlesDelay = React.useCallback(() => {
        const delay = video.state.extraSubtitlesDelay + 250;
        onExtraSubtitlesDelayChanged(delay);
    }, [video.state.extraSubtitlesDelay, onExtraSubtitlesDelayChanged]);

    const onDecreaseSubtitlesDelay = React.useCallback(() => {
        const delay = video.state.extraSubtitlesDelay - 250;
        onExtraSubtitlesDelayChanged(delay);
    }, [video.state.extraSubtitlesDelay, onExtraSubtitlesDelayChanged]);

    const onSubtitlesSizeChanged = React.useCallback((size) => {
        video.setSubtitlesSize(size);
        streamStateChanged({ subtitleSize: size });
    }, [streamStateChanged]);

    const onUpdateSubtitlesSize = React.useCallback((delta) => {
        const sizeIndex = CONSTANTS.SUBTITLES_SIZES.indexOf(video.state.subtitlesSize);
        const size = CONSTANTS.SUBTITLES_SIZES[Math.max(0, Math.min(CONSTANTS.SUBTITLES_SIZES.length - 1, sizeIndex + delta))];
        onSubtitlesSizeChanged(size);
    }, [video.state.subtitlesSize, onSubtitlesSizeChanged]);

    const onSubtitlesOffsetChanged = React.useCallback((offset) => {
        video.setSubtitlesOffset(offset);
        streamStateChanged({ subtitleOffset: offset });
    }, [streamStateChanged]);

    const onDismissNextVideoPopup = React.useCallback(() => {
        closeNextVideoPopup();
        nextVideoPopupDismissed.current = true;
    }, []);

    const onNextVideoRequested = React.useCallback(() => {
        if (player.nextVideo !== null) {
            nextVideo();

            const deepLinks = player.nextVideo.deepLinks;
            handleNextVideoNavigation(deepLinks, profile.settings.bingeWatching, false);
        }
    }, [player.nextVideo, handleNextVideoNavigation, profile.settings]);

    const onVideoClick = React.useCallback(() => {
        if (video.state.paused !== null) {
            if (video.state.paused) {
                onPlayRequestedDebounced();
            } else {
                onPauseRequestedDebounced();
            }
        }
    }, [video.state.paused]);

    const onVideoDoubleClick = React.useCallback(() => {
        onPlayRequestedDebounced.cancel();
        onPauseRequestedDebounced.cancel();
        toggleFullscreen();
    }, [toggleFullscreen]);

    const onContainerMouseDown = React.useCallback((event) => {
        if (!event.nativeEvent.optionsMenuClosePrevented) {
            closeOptionsMenu();
        }
        if (!event.nativeEvent.subtitlesMenuClosePrevented) {
            closeSubtitlesMenu();
        }
        if (!event.nativeEvent.audioMenuClosePrevented) {
            closeAudioMenu();
        }
        if (!event.nativeEvent.speedMenuClosePrevented) {
            closeSpeedMenu();
        }
        if (!event.nativeEvent.statisticsMenuClosePrevented) {
            closeStatisticsMenu();
        }

        closeSideDrawer();
    }, []);

    const onContainerMouseMove = React.useCallback((event) => {
        setImmersed(false);
        if (!event.nativeEvent.immersePrevented) {
            setImmersedDebounced(true);
        } else {
            setImmersedDebounced.cancel();
        }
    }, []);

    const onContainerMouseLeave = React.useCallback(() => {
        setImmersedDebounced.cancel();
        setImmersed(true);
    }, []);

    const onBarMouseMove = React.useCallback((event) => {
        event.nativeEvent.immersePrevented = true;
    }, []);

    onFileDrop(CONSTANTS.SUPPORTED_LOCAL_SUBTITLES, async (filename, buffer) => {
        video.addLocalSubtitles(filename, buffer);
    });

    const getVideoId = React.useCallback(() => {
        // Prioridad 1: videoId (tt0877057:1:1) - universal, funciona con debrid y torrents
        const videoId = player.selected?.streamRequest?.path?.id;
        // Prioridad 2: infoHash del torrent
        const infoHash = player.selected?.stream?.infoHash;
        const id = videoId || infoHash;
        skipIntroLog('getVideoId - videoId:', videoId, 'infoHash:', infoHash, 'usando:', id);
        return id;
    }, [player.selected]);

    const submitMarker = React.useCallback((startTime, endTime, skipType) => {
        const id = getVideoId();
        if (!id) {
            skipIntroLog.error('No hay identificador, abortando');
            return;
        }

        setMarkingMode('saving');

        // Parseamos videoId (tt0877057:1:1 -> imdb_id, season, episode)
        const parts = id.split(':');
        const durationSec = video.state.duration ? Math.round(video.state.duration / 1000) : 0;
        const body = {
            infohash: id,
            imdb_id: parts[0] || null,
            season: parts[1] ? parseInt(parts[1]) : null,
            episode: parts[2] ? parseInt(parts[2]) : null,
            duration: durationSec,
            skip_type: skipType,
            start_time: startTime,
            end_time: endTime,
            user_id: getUserId(),
        };
        skipIntroLog('Enviando POST (' + skipType + '):', JSON.stringify(body));

        const label = skipType === 'credits' ? 'Créditos' : 'Intro';
        fetch(getApiBaseUrl() + '/api/intro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(res => {
                skipIntroLog('Respuesta POST:', res.status, res.statusText);
                return res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`);
            })
            .then((data) => {
                skipIntroLog(label + ' guardada OK:', data);
                const saved = { id: data.id, start_time: startTime, end_time: endTime };
                if (skipType === 'credits') {
                    setCreditsData(saved);
                } else {
                    setIntroData(saved);
                }
                setMarkingMode(false);
                setIntroStart(null);
                if (data.fused) {
                    toast.show({ type: 'success', title: `${label} confirmada`, message: `Tu marcación coincide con una existente (+1 voto, total: ${data.votes})`, timeout: 3500 });
                } else {
                    toast.show({ type: 'success', title: `${label} guardada`, message: `Otros usuarios podrán saltar ${skipType === 'credits' ? 'los créditos' : 'esta intro'}`, timeout: 3000 });
                }
            })
            .catch(err => {
                skipIntroLog.error('Error guardando ' + label + ':', err);
                setMarkingMode('end');
            });
    }, [player.selected, getVideoId, video.state.duration, getUserId]);

    React.useEffect(() => {
        const id = getVideoId();

        setMarkingMode(false);
        setIntroStart(null);

        // Guard clause: esperamos a que el reproductor sepa cuánto dura el video realmente
        if (!video.state.duration || video.state.duration <= 0) {
            return;
        }

        if (id) {
            skipIntroLog('Buscando markers para:', id, 'duración:', video.state.duration, 'ms');
            setIntroData(null);
            setCreditsData(null);

            // Parseamos el videoId (tt0877057:1:1) para enviar query params de fallback
            const parts = id.split(':');
            const durationSec = Math.round(video.state.duration / 1000);
            const queryParams = parts.length >= 3
                ? `?imdb_id=${encodeURIComponent(parts[0])}&season=${encodeURIComponent(parts[1])}&episode=${encodeURIComponent(parts[2])}&duration=${durationSec}`
                : `?duration=${durationSec}`;

            fetch(getApiBaseUrl() + '/api/markers/' + encodeURIComponent(id) + queryParams)
                .then(res => res.ok ? res.json() : null)
                .then(data => {
                    if (data) {
                        if (data.intro) {
                            skipIntroLog('Intro encontrada:', data.intro);
                            setIntroData(data.intro);
                        }
                        if (data.credits) {
                            skipIntroLog('Créditos encontrados:', data.credits);
                            setCreditsData(data.credits);
                        }
                    }
                })
                .catch(err => skipIntroLog.error('Error buscando markers:', err));
        }
    }, [player.selected, getVideoId, video.state.duration]);

    React.useEffect(() => {
        if (!showVerification) return;
        const timer = setTimeout(() => {
            setShowVerification(false);
            setVotedIntroId(null);
        }, 8000);
        return () => clearTimeout(timer);
    }, [showVerification]);

    React.useEffect(() => {
        if (video.state.time === null) return;
        const currentTime = video.state.time / 1000;

        // Intro
        if (introData) {
            if (currentTime >= introData.start_time && currentTime <= introData.end_time) {
                if (!showSkipButton) setShowSkipButton(true);
            } else {
                if (showSkipButton) setShowSkipButton(false);
            }
        }

    }, [video.state.time, introData, creditsData]);

    React.useEffect(() => {
        setError(null);
        video.unload();

        if (player.selected && player.stream?.type === 'Ready' && streamingServer.settings?.type !== 'Loading') {
            video.load({
                stream: {
                    ...player.stream.content,
                    subtitles: Array.isArray(player.selected.stream.subtitles) ?
                        player.selected.stream.subtitles.map((subtitles) => ({
                            ...subtitles,
                            label: subtitles.url
                        }))
                        :
                        []
                },
                autoplay: true,
                time: player.libraryItem !== null &&
                    player.selected.streamRequest !== null &&
                    player.selected.streamRequest.path !== null &&
                    player.libraryItem.state.video_id === player.selected.streamRequest.path.id ?
                    player.libraryItem.state.timeOffset
                    :
                    0,
                forceTranscoding: forceTranscoding || casting,
                maxAudioChannels: settings.surroundSound ? 32 : 2,
                hardwareDecoding: settings.hardwareDecoding,
                assSubtitlesStyling: settings.assSubtitlesStyling,
                videoMode: settings.videoMode,
                platform: platform.name,
                streamingServerURL: streamingServer.baseUrl ?
                    casting ?
                        streamingServer.baseUrl
                        :
                        streamingServer.selected.transportUrl
                    :
                    null,
                seriesInfo: player.seriesInfo,
            }, {
                chromecastTransport: services.chromecast.active ? services.chromecast.transport : null,
                shellTransport: services.shell.active ? services.shell.transport : null,
            });
        }
    }, [streamingServer.baseUrl, player.selected, player.stream, forceTranscoding, casting]);
    React.useEffect(() => {
        if (video.state.stream !== null) {
            const tracks = player.subtitles.map((subtitles) => ({
                ...subtitles,
                label: subtitles.url
            }));
            video.addExtraSubtitlesTracks(tracks);
        }
    }, [player.subtitles, video.state.stream]);

    React.useEffect(() => {
        !seeking && timeChanged(video.state.time, video.state.duration, video.state.manifest?.name);
    }, [video.state.time, video.state.duration, video.state.manifest, seeking]);

    React.useEffect(() => {
        if (video.state.paused !== null) {
            pausedChanged(video.state.paused);
        }
    }, [video.state.paused]);

    React.useEffect(() => {
        videoParamsChanged(video.state.videoParams);
    }, [video.state.videoParams]);

    // Popup "siguiente capítulo": si hay marker de inicio de créditos, abrirlo exactamente al llegar a ese momento; si no, usar el criterio por defecto (X segundos antes del final).
    React.useEffect(() => {
        if (player.nextVideo === null) return;
        if (player.nextVideo) {
            window.playerNextVideo = player.nextVideo;
        } else {
            window.playerNextVideo = null;
        }
        if (nextVideoPopupDismissed.current) return;

        const time = video.state.time;
        const duration = video.state.duration;
        if (time === null || duration === null) return;

        const timeSec = time / 1000;
        const hasCreditsStart = creditsData && typeof creditsData.start_time === 'number';

        if (hasCreditsStart && timeSec >= creditsData.start_time) {
            if (!creditsPopupShownRef.current) {
                creditsPopupShownRef.current = true;
                openNextVideoPopup();
            }
        } else if (!hasCreditsStart && time < duration && (duration - time) <= settings.nextVideoNotificationDuration) {
            openNextVideoPopup();
        } else {
            closeNextVideoPopup();
        }
    }, [player.nextVideo, video.state.time, video.state.duration, creditsData, settings.nextVideoNotificationDuration]);


    // Auto subtitles track selection
    React.useEffect(() => {
        if (!defaultSubtitlesSelected.current) {
            if (settings.subtitlesLanguage === null) {
                video.setSubtitlesTrack(null);
                video.setExtraSubtitlesTrack(null);
                defaultSubtitlesSelected.current = true;
                return;
            }

            const savedTrackId = player.streamState?.subtitleTrack?.id;
            const subtitlesTrack = savedTrackId ?
                findTrackById(video.state.subtitlesTracks, savedTrackId) :
                findTrackByLang(video.state.subtitlesTracks, settings.subtitlesLanguage);

            const extraSubtitlesTrack = savedTrackId ?
                findTrackById(video.state.extraSubtitlesTracks, savedTrackId) :
                findTrackByLang(video.state.extraSubtitlesTracks, settings.subtitlesLanguage);

            if (subtitlesTrack && subtitlesTrack.id) {
                video.setSubtitlesTrack(subtitlesTrack.id);
                defaultSubtitlesSelected.current = true;
            } else if (extraSubtitlesTrack && extraSubtitlesTrack.id) {
                video.setExtraSubtitlesTrack(extraSubtitlesTrack.id);
                defaultSubtitlesSelected.current = true;
            }
        }
    }, [video.state.subtitlesTracks, video.state.extraSubtitlesTracks, player.streamState]);

    // Auto audio track selection
    React.useEffect(() => {
        if (!defaultAudioTrackSelected.current) {
            const savedTrackId = player.streamState?.audioTrack?.id;
            const audioTrack = savedTrackId ?
                findTrackById(video.state.audioTracks, savedTrackId) :
                findTrackByLang(video.state.audioTracks, settings.audioLanguage);

            if (audioTrack && audioTrack.id) {
                video.setAudioTrack(audioTrack.id);
                defaultAudioTrackSelected.current = true;
            }
        }
    }, [video.state.audioTracks, player.streamState]);

    // Saved subtitles settings
    React.useEffect(() => {
        if (video.state.stream !== null) {
            const delay = player.streamState?.subtitleDelay;
            if (typeof delay === 'number') {
                video.setSubtitlesDelay(delay);
            }

            const size = player.streamState?.subtitleSize;
            if (typeof size === 'number') {
                video.setSubtitlesSize(size);
            }

            const offset = player.streamState?.subtitleOffset;
            if (typeof offset === 'number') {
                video.setSubtitlesOffset(offset);
            }
        }
    }, [video.state.stream, player.streamState]);

    React.useEffect(() => {
        defaultSubtitlesSelected.current = false;
        defaultAudioTrackSelected.current = false;
        nextVideoPopupDismissed.current = false;
        creditsPopupShownRef.current = false;
        setTimeout(() => isNavigating.current = false, 1000);
    }, [video.state.stream]);

    React.useEffect(() => {
        if ((!Array.isArray(video.state.subtitlesTracks) || video.state.subtitlesTracks.length === 0) &&
            (!Array.isArray(video.state.extraSubtitlesTracks) || video.state.extraSubtitlesTracks.length === 0)) {
            closeSubtitlesMenu();
        }
    }, [video.state.subtitlesTracks, video.state.extraSubtitlesTracks]);

    React.useEffect(() => {
        if (!Array.isArray(video.state.audioTracks) || video.state.audioTracks.length === 0) {
            closeAudioMenu();
        }
    }, [video.state.audioTracks]);

    React.useEffect(() => {
        if (video.state.playbackSpeed === null) {
            closeSpeedMenu();
        }
    }, [video.state.playbackSpeed]);

    React.useEffect(() => {
        const toastFilter = (item) => item?.dataset?.type === 'CoreEvent';
        toast.addFilter(toastFilter);
        const onCastStateChange = () => {
            setCasting(services.chromecast.active && services.chromecast.transport.getCastState() === cast.framework.CastState.CONNECTED);
        };
        const onChromecastServiceStateChange = () => {
            onCastStateChange();
            if (services.chromecast.active) {
                services.chromecast.transport.on(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
        const onCoreEvent = ({ event }) => {
            if (event === 'PlayingOnDevice') {
                onPauseRequested();
            }
        };
        services.chromecast.on('stateChanged', onChromecastServiceStateChange);
        services.core.transport.on('CoreEvent', onCoreEvent);
        onChromecastServiceStateChange();
        return () => {
            toast.removeFilter(toastFilter);
            services.chromecast.off('stateChanged', onChromecastServiceStateChange);
            services.core.transport.off('CoreEvent', onCoreEvent);
            if (services.chromecast.active) {
                services.chromecast.transport.off(
                    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
                    onCastStateChange
                );
            }
        };
    }, []);

    React.useEffect(() => {
        if (settings.pauseOnMinimize && (shell.windowClosed || shell.windowHidden)) {
            onPauseRequested();
        }
    }, [settings.pauseOnMinimize, shell.windowClosed, shell.windowHidden]);

    // Media Session PlaybackState
    React.useEffect(() => {
        if (!navigator.mediaSession) return;

        const playbackState = !video.state.paused ? 'playing' : 'paused';
        navigator.mediaSession.playbackState = playbackState;

        return () => navigator.mediaSession.playbackState = 'none';
    }, [video.state.paused]);

    // Media Session Metadata
    React.useEffect(() => {
        if (!navigator.mediaSession) return;

        const metaItem = player.metaItem && player.metaItem?.type === 'Ready' ? player.metaItem.content : null;
        const videoId = player.selected ? player.selected?.streamRequest?.path?.id : null;
        const video = metaItem ? metaItem.videos.find(({ id }) => id === videoId) : null;

        const videoInfo = video && video.season && video.episode ? ` (${video.season}x${video.episode})` : null;
        const videoTitle = video ? `${video.title}${videoInfo}` : null;
        const metaTitle = metaItem ? metaItem.name : null;
        const imageUrl = metaItem ? metaItem.logo : null;

        const title = videoTitle ?? metaTitle;
        const artist = videoTitle ? metaTitle : undefined;
        const artwork = imageUrl ? [{ src: imageUrl }] : undefined;

        if (title) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title,
                artist,
                artwork,
            });
        }
    }, [player.metaItem, player.selected]);

    // Media Session Actions
    React.useEffect(() => {
        if (!navigator.mediaSession) return;

        navigator.mediaSession.setActionHandler('play', onPlayRequested);
        navigator.mediaSession.setActionHandler('pause', onPauseRequested);

        const nexVideoCallback = player.nextVideo ? onNextVideoRequested : null;
        navigator.mediaSession.setActionHandler('nexttrack', nexVideoCallback);
    }, [player.nextVideo, onPlayRequested, onPauseRequested, onNextVideoRequested]);

    onShortcut('playPause', () => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.paused !== null) {
            if (video.state.paused) {
                onPlayRequested();
                setSeeking(false);
            } else {
                onPauseRequested();
            }
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.paused, onPlayRequested, onPauseRequested]);

    onShortcut('seekForward', (combo) => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            setSeeking(true);
            onSeekRequested(video.state.time + seekDuration);
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.time, onSeekRequested]);

    onShortcut('seekBackward', (combo) => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.time !== null) {
            const seekDuration = combo === 1 ? settings.seekShortTimeDuration : settings.seekTimeDuration;
            setSeeking(true);
            onSeekRequested(video.state.time - seekDuration);
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.time, onSeekRequested]);

    onShortcut('mute', () => {
        video.state.muted === true ? onUnmuteRequested() : onMuteRequested();
    }, [video.state.muted]);

    onShortcut('volumeUp', () => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.min(video.state.volume + 5, 200));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    onShortcut('volumeDown', () => {
        if (!menusOpen && !nextVideoPopupOpen && video.state.volume !== null) {
            onVolumeChangeRequested(Math.min(video.state.volume - 5, 200));
        }
    }, [menusOpen, nextVideoPopupOpen, video.state.volume]);

    onShortcut('subtitlesDelay', (combo) => {
        combo === 1 ? onIncreaseSubtitlesDelay() : onDecreaseSubtitlesDelay();
    }, [onIncreaseSubtitlesDelay, onDecreaseSubtitlesDelay]);

    onShortcut('subtitlesSize', (combo) => {
        combo === 1 ? onUpdateSubtitlesSize(-1) : onUpdateSubtitlesSize(1);
    }, [onUpdateSubtitlesSize, onUpdateSubtitlesSize]);

    onShortcut('toggleSubtitles', () => {
        const savedTrack = player.streamState?.subtitleTrack;

        if (subtitlesEnabled.current) {
            video.setSubtitlesTrack(null);
            video.setExtraSubtitlesTrack(null);
        } else if (savedTrack?.id) {
            savedTrack.embedded ? video.setSubtitlesTrack(savedTrack.id) : video.setExtraSubtitlesTrack(savedTrack.id);
        }

        subtitlesEnabled.current = !subtitlesEnabled.current;
    }, [player.streamState]);

    onShortcut('subtitlesMenu', () => {
        closeMenus();
        if (video.state?.subtitlesTracks?.length > 0 || video.state?.extraSubtitlesTracks?.length > 0) {
            toggleSubtitlesMenu();
        }
    }, [video.state.subtitlesTracks, video.state.extraSubtitlesTracks, toggleSubtitlesMenu]);

    onShortcut('audioMenu', () => {
        closeMenus();
        if (video.state?.audioTracks?.length > 0) {
            toggleAudioMenu();
        }
    }, [video.state.audioTracks, toggleAudioMenu]);

    onShortcut('infoMenu', () => {
        closeMenus();
        if (player.metaItem?.type === 'Ready') {
            toggleSideDrawer();
        }
    }, [player.metaItem, toggleSideDrawer]);

    onShortcut('speedMenu', () => {
        closeMenus();
        if (video.state.playbackSpeed !== null) {
            toggleSpeedMenu();
        }
    }, [video.state.playbackSpeed, toggleSpeedMenu]);

    onShortcut('statisticsMenu', () => {
        closeMenus();
        const stream = player.selected?.stream;
        if (streamingServer?.statistics?.type !== 'Err' && typeof stream === 'string' && typeof stream === 'number') {
            toggleStatisticsMenu();
        }
    }, [player.selected, streamingServer.statistics, toggleStatisticsMenu]);

    onShortcut('exit', () => {
        closeMenus();
        !settings.escExitFullscreen && window.history.back();
    }, [settings.escExitFullscreen]);

    React.useLayoutEffect(() => {
        const onKeyUp = (event) => {
            if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
                setSeeking(false);
            }
        };
        const onWheel = ({ deltaY }) => {
            if (menusOpen || video.state.volume === null) return;

            if (deltaY > 0) {
                onVolumeChangeRequested(Math.max(video.state.volume - 5, 0));
            } else {
                if (video.state.volume < 100) {
                    onVolumeChangeRequested(Math.min(video.state.volume + 5, 100));
                }
            }
        };
        if (routeFocused) {
            window.addEventListener('keyup', onKeyUp);
            window.addEventListener('wheel', onWheel);
        }
        return () => {
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('wheel', onWheel);
        };
    }, [routeFocused, menusOpen, video.state.volume]);

    React.useEffect(() => {
        video.events.on('error', onError);
        video.events.on('ended', onEnded);
        video.events.on('subtitlesTrackLoaded', onSubtitlesTrackLoaded);
        video.events.on('extraSubtitlesTrackLoaded', onExtraSubtitlesTrackLoaded);
        video.events.on('extraSubtitlesTrackAdded', onExtraSubtitlesTrackAdded);
        video.events.on('implementationChanged', onImplementationChanged);

        return () => {
            video.events.off('error', onError);
            video.events.off('ended', onEnded);
            video.events.off('subtitlesTrackLoaded', onSubtitlesTrackLoaded);
            video.events.off('extraSubtitlesTrackLoaded', onExtraSubtitlesTrackLoaded);
            video.events.off('extraSubtitlesTrackAdded', onExtraSubtitlesTrackAdded);
            video.events.off('implementationChanged', onImplementationChanged);
        };
    }, []);

    React.useLayoutEffect(() => {
        return () => {
            setImmersedDebounced.cancel();
            onPlayRequestedDebounced.cancel();
            onPauseRequestedDebounced.cancel();
        };
    }, []);

    const getUserId = React.useCallback(() => {
        try {
            let uid = localStorage.getItem('skip_user_id');
            if (!uid) {
                uid = 'u_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
                localStorage.setItem('skip_user_id', uid);
            }
            return uid;
        } catch { return null; }
    }, []);

    const hasVoted = React.useCallback((introId) => {
        try {
            const voted = JSON.parse(localStorage.getItem('skip_voted') || '{}');
            return !!voted[introId];
        } catch { return false; }
    }, []);

    const markAsVoted = React.useCallback((introId) => {
        try {
            const voted = JSON.parse(localStorage.getItem('skip_voted') || '{}');
            voted[introId] = Date.now();
            // Limpiar votos antiguos (>30 días) para no crecer infinitamente
            const thirtyDays = 30 * 24 * 60 * 60 * 1000;
            for (const key in voted) {
                if (Date.now() - voted[key] > thirtyDays) delete voted[key];
            }
            localStorage.setItem('skip_voted', JSON.stringify(voted));
        } catch { /* localStorage no disponible */ }
    }, []);

    const handleSkip = React.useCallback((e, skipType) => {
        e.stopPropagation(); e.preventDefault();
        const data = skipType === 'credits' ? creditsData : introData;
        if (!data) return;
        onSeekRequested(data.end_time * 1000);
        if (hasVoted(data.id)) {
            if (skipType === 'credits') { /* popup se abre al llegar al inicio de créditos */ }
            else setShowSkipButton(false);
            return;
        }
        setVotedIntroId(data.id);
        setActiveSkipType(skipType);
        setVoteSent(false);
        if (skipType === 'credits') { /* popup siguiente capítulo se abre al inicio de créditos */ }
        else setShowSkipButton(false);
        setShowVerification(true);
    }, [introData, creditsData, onSeekRequested, hasVoted]);

    const handleUpvote = React.useCallback((e) => {
        e.stopPropagation(); e.preventDefault();
        if (!votedIntroId || voteSent) return;
        setVoteSent(true);
        markAsVoted(votedIntroId);
        const uid = getUserId();
        fetch(getApiBaseUrl() + '/api/intro/' + votedIntroId + '/upvote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: uid }),
        })
            .then(res => {
                if (res.status === 409) {
                    toast.show({ type: 'success', title: 'Ya votaste', message: 'Tu voto ya estaba registrado', timeout: 2000 });
                    return;
                }
                return res.json();
            })
            .then((data) => {
                if (data) toast.show({ type: 'success', title: '¡Gracias!', message: 'Tu voto ayuda a la comunidad', timeout: 2500 });
            })
            .catch(err => skipIntroLog.error('Error en upvote:', err));
        setShowVerification(false);
        setVotedIntroId(null);
        setActiveSkipType(null);
    }, [votedIntroId, voteSent, markAsVoted, getUserId]);

    const handleDownvote = React.useCallback((e) => {
        e.stopPropagation(); e.preventDefault();
        if (!votedIntroId || voteSent) return;
        setVoteSent(true);
        markAsVoted(votedIntroId);
        const uid = getUserId();
        fetch(getApiBaseUrl() + '/api/intro/' + votedIntroId + '/downvote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: uid }),
        })
            .catch(err => skipIntroLog.error('Error en downvote:', err));
        const label = activeSkipType === 'credits' ? 'Créditos descartados' : 'Intro descartada';
        // Limpiar datos y abrir marcado del tipo correspondiente
        setShowVerification(false);
        setVotedIntroId(null);
        if (activeSkipType === 'credits') {
            setCreditsData(null);
        } else {
            setIntroData(null);
        }
        setMarkingType(activeSkipType || 'intro');
        setMarkingMode('start');
        setActiveSkipType(null);
        toast.show({ type: 'error', title: label, message: 'Marca los tiempos correctos para tu versión.', timeout: 3000 });
    }, [votedIntroId, voteSent, activeSkipType]);

    return (
        <div className={classnames(styles['player-container'], { [styles['overlayHidden']]: overlayHidden })}
            onMouseDown={onContainerMouseDown}
            onMouseMove={onContainerMouseMove}
            onMouseOver={onContainerMouseMove}
            onMouseLeave={onContainerMouseLeave}>
            <Video
                ref={video.containerRef}
                className={styles['layer']}
                onClick={onVideoClick}
                onDoubleClick={onVideoDoubleClick}
            />
            {
                !video.state.loaded ?
                    <div className={classnames(styles['layer'], styles['background-layer'])}>
                        <img className={styles['image']} src={player?.metaItem?.content?.background} />
                    </div>
                    :
                    null
            }
            {
                (video.state.buffering || !video.state.loaded) && !error ?
                    <BufferingLoader
                        ref={bufferingRef}
                        className={classnames(styles['layer'], styles['buffering-layer'])}
                        logo={player?.metaItem?.content?.logo}
                    />
                    :
                    null
            }
            {
                error !== null ?
                    <Error
                        ref={errorRef}
                        className={classnames(styles['layer'], styles['error-layer'])}
                        stream={video.state.stream}
                        {...error}
                    />
                    :
                    null
            }
            {
                menusOpen ?
                    <div className={styles['layer']} />
                    :
                    null
            }
            {
                video.state.volume !== null && overlayHidden ?
                    <VolumeChangeIndicator
                        muted={video.state.muted}
                        volume={video.state.volume}
                    />
                    :
                    null
            }
            <ContextMenu on={[video.containerRef, bufferingRef, errorRef]} autoClose>
                <OptionsMenu
                    className={classnames(styles['layer'], styles['menu-layer'])}
                    stream={player?.selected?.stream}
                    playbackDevices={playbackDevices}
                    extraSubtitlesTracks={video.state.extraSubtitlesTracks}
                    selectedExtraSubtitlesTrackId={video.state.selectedExtraSubtitlesTrackId}
                />
            </ContextMenu>
            <HorizontalNavBar
                className={classnames(styles['layer'], styles['nav-bar-layer'])}
                title={player.title !== null ? player.title : ''}
                backButton={true}
                fullscreenButton={true}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
            />
            {
                player.metaItem?.type === 'Ready' ?
                    <SideDrawerButton
                        className={classnames(styles['layer'], styles['side-drawer-button-layer'])}
                        onClick={toggleSideDrawer}
                    />
                    :
                    null
            }
            <ControlBar
                className={classnames(styles['layer'], styles['control-bar-layer'])}
                paused={video.state.paused}
                time={video.state.time}
                duration={video.state.duration}
                buffered={video.state.buffered}
                volume={video.state.volume}
                muted={video.state.muted}
                playbackSpeed={video.state.playbackSpeed}
                subtitlesTracks={video.state.subtitlesTracks.concat(video.state.extraSubtitlesTracks)}
                audioTracks={video.state.audioTracks}
                metaItem={player.metaItem}
                nextVideo={player.nextVideo}
                stream={player.selected !== null ? player.selected.stream : null}
                statistics={statistics}
                onPlayRequested={onPlayRequested}
                onPauseRequested={onPauseRequested}
                onNextVideoRequested={onNextVideoRequested}
                onMuteRequested={onMuteRequested}
                onUnmuteRequested={onUnmuteRequested}
                onVolumeChangeRequested={onVolumeChangeRequested}
                onSeekRequested={onSeekRequested}
                onToggleOptionsMenu={toggleOptionsMenu}
                onToggleSubtitlesMenu={toggleSubtitlesMenu}
                onToggleAudioMenu={toggleAudioMenu}
                onToggleSpeedMenu={toggleSpeedMenu}
                onToggleStatisticsMenu={toggleStatisticsMenu}
                onToggleSideDrawer={toggleSideDrawer}
                onMouseMove={onBarMouseMove}
                onMouseOver={onBarMouseMove}
                onTouchEnd={onContainerMouseLeave}
            />

            {/* --- BOTÓN SALTAR INTRO --- */}
            {showSkipButton && introData && !showVerification ? (
                <button
                    className={styles['skip-intro-btn']}
                    onClick={(e) => handleSkip(e, 'intro')}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                >
                    SALTAR INTRO
                </button>
            ) : null}

            {/* Créditos: no hay botón "Saltar"; el popup de siguiente capítulo se abre al llegar al inicio marcado por la comunidad. */}

            {/* --- PANEL DE VERIFICACIÓN POST-SKIP (genérico: intro o créditos) --- */}
            {showVerification ? (
                <div
                    className={styles['skip-intro-verification-panel']}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                >
                    <span className={styles['skip-intro-verification-label']}>
                        {activeSkipType === 'credits' ? '¿Los créditos fueron correctos?' : '¿La intro fue correcta?'}
                    </span>
                    <div className={styles['skip-intro-verification-buttons']}>
                        <button
                            className={classnames(styles['skip-intro-btn-upvote'], voteSent && styles['skip-intro-vote-disabled'])}
                            onClick={handleUpvote}
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            disabled={voteSent}
                        >
                            Sí, correcta
                        </button>
                        <button
                            className={classnames(styles['skip-intro-btn-downvote'], voteSent && styles['skip-intro-vote-disabled'])}
                            onClick={handleDownvote}
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            disabled={voteSent}
                        >
                            No, incorrecta
                        </button>
                    </div>
                </div>
            ) : null}

            {/* --- BOTONES MARCAR INTRO / CRÉDITOS (cuando no hay datos y controles visibles) --- */}
            {!markingMode && !showVerification && !overlayHidden && !showSkipButton && video.state.time !== null && video.state.duration > 0 ? (
                <div className={styles['skip-intro-marking-toolbar']}>
                    {!introData ? (
                        <button
                            className={classnames(styles['skip-intro-btn-toolbar'], styles['intro'])}
                            onClick={(e) => {
                                e.stopPropagation(); e.preventDefault();
                                const currentSec = Math.floor(video.state.time / 1000);
                                setMarkingType('intro');
                                setIntroStart(currentSec);
                                setMarkingMode('end');
                            }}
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        >
                            Marcar Intro
                        </button>
                    ) : null}
                    {!creditsData ? (
                        <button
                            className={classnames(styles['skip-intro-btn-toolbar'], styles['credits'])}
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMarkingType('credits'); setMarkingMode('start'); }}
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        >
                            Marcar Créditos
                        </button>
                    ) : null}
                </div>
            ) : null}

            {/* --- PANEL DE MARCADO (genérico: intro o créditos) --- */}
            {markingMode ? (
                <div
                    className={styles['skip-intro-marking-panel']}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                >
                    <span className={styles['skip-intro-marking-text']}>
                        {markingMode === 'start' && markingType === 'credits' && 'Reproduce hasta el INICIO de los créditos'}
                        {markingMode === 'end' && markingType === 'intro' && `Inicio: ${Math.floor(introStart / 60)}:${String(introStart % 60).padStart(2, '0')} — Reproduce hasta el FIN de la intro`}
                        {markingMode === 'saving' && 'Guardando...'}
                    </span>
                    {markingMode !== 'saving' ? (
                        <button
                            className={classnames(
                                markingMode === 'end' ? styles['skip-intro-btn-mark-end'] : styles['skip-intro-btn-mark-start'],
                                markingMode === 'start' && markingType === 'credits' && styles['credits']
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const currentSec = Math.floor(video.state.time / 1000);
                                skipIntroLog('Boton click - mode:', markingMode, 'type:', markingType, 'currentSec:', currentSec);
                                if (markingType === 'credits' && markingMode === 'start') {
                                    submitMarker(currentSec, currentSec + 5, 'credits');
                                    setMarkingMode(false);
                                    setIntroStart(null);
                                } else {
                                    submitMarker(introStart, currentSec, markingType);
                                }
                            }}
                            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        >
                            {markingType === 'credits' && markingMode === 'start' ? 'Marcar inicio de créditos' : 'Marcar Final'}
                        </button>
                    ) : null}
                    <button
                        className={styles['skip-intro-btn-cancel']}
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMarkingMode(false); setIntroStart(null); }}
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    >
                        Cancelar
                    </button>
                </div>
            ) : null}
            {/* ---------------------------------- */}

            <Indicator
                className={classnames(styles['layer'], styles['indicator-layer'])}
                videoState={video.state}
                disabled={subtitlesMenuOpen}
            />
            {
                nextVideoPopupOpen ?
                    <NextVideoPopup
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        metaItem={player.metaItem !== null && player.metaItem.type === 'Ready' ? player.metaItem.content : null}
                        nextVideo={player.nextVideo}
                        onDismiss={onDismissNextVideoPopup}
                        onNextVideoRequested={onNextVideoRequested}
                    />
                    :
                    null
            }
            {
                statisticsMenuOpen ?
                    <StatisticsMenu
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        {...statistics}
                    />
                    :
                    null
            }
            <Transition when={sideDrawerOpen} name={'slide-left'}>
                <SideDrawer
                    className={classnames(styles['layer'], styles['side-drawer-layer'])}
                    metaItem={player.metaItem?.content}
                    seriesInfo={player.seriesInfo}
                    closeSideDrawer={closeSideDrawer}
                    selected={player.selected?.streamRequest?.path.id}
                />
            </Transition>
            {
                subtitlesMenuOpen ?
                    <SubtitlesMenu
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        subtitlesTracks={video.state.subtitlesTracks}
                        selectedSubtitlesTrackId={video.state.selectedSubtitlesTrackId}
                        subtitlesOffset={video.state.subtitlesOffset}
                        subtitlesSize={video.state.subtitlesSize}
                        extraSubtitlesTracks={video.state.extraSubtitlesTracks}
                        selectedExtraSubtitlesTrackId={video.state.selectedExtraSubtitlesTrackId}
                        extraSubtitlesOffset={video.state.extraSubtitlesOffset}
                        extraSubtitlesDelay={video.state.extraSubtitlesDelay}
                        extraSubtitlesSize={video.state.extraSubtitlesSize}
                        onSubtitlesTrackSelected={onSubtitlesTrackSelected}
                        onExtraSubtitlesTrackSelected={onExtraSubtitlesTrackSelected}
                        onSubtitlesOffsetChanged={onSubtitlesOffsetChanged}
                        onSubtitlesSizeChanged={onSubtitlesSizeChanged}
                        onExtraSubtitlesOffsetChanged={onSubtitlesOffsetChanged}
                        onExtraSubtitlesDelayChanged={onExtraSubtitlesDelayChanged}
                        onExtraSubtitlesSizeChanged={onSubtitlesSizeChanged}
                    />
                    :
                    null
            }
            {
                audioMenuOpen ?
                    <AudioMenu
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        audioTracks={video.state.audioTracks}
                        selectedAudioTrackId={video.state.selectedAudioTrackId}
                        onAudioTrackSelected={onAudioTrackSelected}
                    />
                    :
                    null
            }
            {
                speedMenuOpen ?
                    <SpeedMenu
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        playbackSpeed={video.state.playbackSpeed}
                        onPlaybackSpeedChanged={onPlaybackSpeedChanged}
                    />
                    :
                    null
            }
            {
                optionsMenuOpen ?
                    <OptionsMenu
                        className={classnames(styles['layer'], styles['menu-layer'])}
                        stream={player.selected.stream}
                        playbackDevices={playbackDevices}
                        extraSubtitlesTracks={video.state.extraSubtitlesTracks}
                        selectedExtraSubtitlesTrackId={video.state.selectedExtraSubtitlesTrackId}
                    />
                    :
                    null
            }
        </div>
    );
};

Player.propTypes = {
    urlParams: PropTypes.shape({
        stream: PropTypes.string,
        streamTransportUrl: PropTypes.string,
        metaTransportUrl: PropTypes.string,
        type: PropTypes.string,
        id: PropTypes.string,
        videoId: PropTypes.string
    }),
    queryParams: PropTypes.instanceOf(URLSearchParams)
};

const PlayerFallback = () => (
    <div className={classnames(styles['player-container'])} />
);

module.exports = withCoreSuspender(Player, PlayerFallback);