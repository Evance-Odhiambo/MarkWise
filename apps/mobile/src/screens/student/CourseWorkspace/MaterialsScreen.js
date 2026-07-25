import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SectionList, StyleSheet, Alert, StatusBar, ActivityIndicator,
  TouchableOpacity, TextInput, RefreshControl, ScrollView, Modal, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { WebView } from 'react-native-webview';
import YoutubeIframe from 'react-native-youtube-iframe';
import PDF from 'react-native-pdf';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { fetchMaterials, recordMaterialView } from '../../../utils/materialsApi';
import { getStudentSession } from '../../../utils/authSession';
import { API_BASE_URL } from '../../../utils/constants';
import { useEnrollment } from '../../../context/EnrollmentContext';

import themeColors from '../../../theme/colors';

const toTitleCase = (str) =>
  str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

const resolveUnitName = (unitNamesMap, item) => {
  const raw =
    unitNamesMap?.[item._unitCode || item.unitCode || item.unitId] ||
    item.unitName ||
    item._unitCode ||
    item.unitCode ||
    item.unitId ||
    '';
  return raw ? toTitleCase(String(raw)) : '—';
};

const colors = {
  primary: themeColors.primary,
  success: themeColors.success,
  warning: themeColors.warning,
  danger:  themeColors.danger,
  info:    themeColors.info,
  purple:  themeColors.purple,
  text:    themeColors.text,
  bg:      { screen: themeColors.background.primary, card: themeColors.surface.card, border: themeColors.border.light },
};

const TYPE_FILTERS = [
  { key: 'all',  label: 'All',   icon: 'view-grid-outline' },
  { key: 'file', label: 'Files', icon: 'file-document-outline' },
  { key: 'link', label: 'Links', icon: 'link-variant' },
  { key: 'text', label: 'Text',  icon: 'text-box-outline' },
];

const TYPE_ICONS = {
  pdf:   { icon: 'file-pdf-box',   color: colors.danger.main  ?? '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  file:  { icon: 'file-document',  color: colors.primary.main, bg: colors.primary.soft },
  link:  { icon: 'link-variant',   color: colors.info.main,    bg: colors.info.soft },
  text:  { icon: 'text-box',       color: colors.purple.main,  bg: colors.purple.soft },
  video: { icon: 'play-circle',    color: colors.danger.main,  bg: 'rgba(239,68,68,0.12)' },
};

// ─── Video helpers ─────────────────────────────────────────────────────────────
const isVideoUrl = (url = '') => {
  if (!url) return false;
  if (/\.(mp4|mov|mkv|webm|m3u8)(\?|$)/i.test(url)) return true;
  if (/youtube\.com\/(watch|embed|shorts)|youtu\.be\//i.test(url)) return true;
  if (/vimeo\.com\//i.test(url)) return true;
  if (/drive\.google\.com\/file/i.test(url)) return true;
  if (/loom\.com\/share/i.test(url)) return true;
  return false;
};

const isDirectVideoUrl = (url = '') =>
  /\.(mp4|mov|mkv|webm|m3u8)(\?|$)/i.test(url);

const extractYoutubeId = (url = '') => {
  let m = url.match(/youtube\.com\/watch\?v=([^&]+)/);
  if (m) return m[1];
  m = url.match(/youtu\.be\/([^?]+)/);
  if (m) return m[1];
  m = url.match(/youtube\.com\/shorts\/([^?]+)/);
  if (m) return m[1];
  m = url.match(/youtube\.com\/embed\/([^?]+)/);
  if (m) return m[1];
  return null;
};

const getEmbedUrl = (url = '') => {
  // Non-YouTube embeds only — YouTube is handled by YoutubeIframe
  let m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}?autoplay=1`;
  m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  m = url.match(/loom\.com\/share\/([^?]+)/);
  if (m) return `https://www.loom.com/embed/${m[1]}`;
  return url;
};

const getMaterialIconInfo = (material) => {
  if (material.type === 'link') {
    if (isVideoUrl(material.linkUrl || '')) return TYPE_ICONS.video;
    return TYPE_ICONS.link;
  }
  if (material.type === 'text') return TYPE_ICONS.text;
  if (material.mimeType?.includes('pdf')) return TYPE_ICONS.pdf;
  if (isVideoUrl(material.fileUrl || '') || material.mimeType?.startsWith('video/')) return TYPE_ICONS.video;
  return TYPE_ICONS.file;
};

// ─── Video player modal ───────────────────────────────────────────────────────
const VideoPlayerModal = ({ visible, item, url, onClose }) => {
  const [playing, setPlaying] = useState(false);

  // Reset play state whenever the modal opens with a new video
  useEffect(() => {
    if (visible) setPlaying(true);
    else setPlaying(false);
  }, [visible, url]);

  if (!visible || !item) return null;

  const youtubeId = extractYoutubeId(url);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.videoModal}>
        <View style={styles.videoModalHeader}>
          <Text style={styles.videoModalTitle} numberOfLines={1}>{item.title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.videoCloseBtn}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        {youtubeId ? (
          <View style={styles.youtubeContainer}>
            <YoutubeIframe
              videoId={youtubeId}
              height={220}
              play={playing}
              onChangeState={state => { if (state === 'ended') setPlaying(false); }}
              webViewProps={{
                allowsInlineMediaPlayback: true,
                mediaPlaybackRequiresUserAction: false,
              }}
            />
          </View>
        ) : (
          <WebView
            source={{ uri: getEmbedUrl(url) }}
            style={styles.videoPlayer}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            allowsFullscreenVideo
            startInLoadingState
            renderLoading={() => (
              <View style={styles.videoLoading}>
                <ActivityIndicator size="large" color="#fff" />
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
};

const PdfViewerModal = ({ visible, item, localPath, onClose }) => {
  if (!visible || !item) return null;
  const src = localPath
    ? { uri: localPath.startsWith('file://') ? localPath : `file://${localPath}` }
    : { uri: item.fileUrl };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.videoModal}>
        <View style={styles.videoModalHeader}>
          <Text style={styles.videoModalTitle} numberOfLines={1}>{item.title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.videoCloseBtn}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <PDF
          source={src}
          style={{ flex: 1, backgroundColor: '#f8f8f8' }}
          enableRTL={false}
          renderActivityIndicator={() => <ActivityIndicator size="large" color={colors.primary.main} />}
        />
      </View>
    </Modal>
  );
};

const LinkViewerModal = ({ visible, item, onClose }) => {
  if (!visible || !item) return null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.videoModal}>
        <View style={styles.videoModalHeader}>
          <Text style={styles.videoModalTitle} numberOfLines={1}>{item.title || item.linkUrl}</Text>
          <TouchableOpacity onPress={onClose} style={styles.videoCloseBtn}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <WebView
          source={{ uri: item.linkUrl }}
          style={styles.videoPlayer}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo
          startInLoadingState
          renderLoading={() => (
            <View style={styles.videoLoading}>
              <ActivityIndicator size="large" color={colors.primary.main} />
            </View>
          )}
        />
      </View>
    </Modal>
  );
};

const DetailModal = ({ visible, item, onClose, onDownload, onOpen, onOpenLink = () => {}, onPlayVideo = () => {}, downloadState, unitNamesMap }) => {
  if (!item) return null;
  const iconInfo = getMaterialIconInfo(item);
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={[styles.modalIcon, { backgroundColor: iconInfo.bg }]}>
              <Icon name={iconInfo.icon} size={24} color={iconInfo.color} />
            </View>
            <Text style={styles.modalTitle} numberOfLines={2}>{item.title}</Text>
            <TouchableOpacity onPress={onClose} style={{ marginLeft: 8 }}>
              <Icon name="close" size={24} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 400 }}>
            {item.description ? (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Description</Text>
                <Text style={styles.detailValue}>{item.description}</Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Type</Text>
                <Text style={styles.detailValue}>{item.type}</Text>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Unit</Text>
                <Text style={styles.detailValue}>
                  {resolveUnitName(unitNamesMap, item)}
                </Text>
              </View>
            </View>
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Uploaded</Text>
              <Text style={styles.detailValue}>{new Date(Number(item.createdAt) || item.createdAt).toLocaleDateString()}</Text>
            </View>

            {item.type === 'link' && item.linkUrl && (
              isVideoUrl(item.linkUrl) ? (
                <View style={{ gap: 8, marginTop: 4 }}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.danger.main }]}
                    onPress={() => onPlayVideo(item, item.linkUrl)}
                  >
                    <Icon name="play" size={16} color="#fff" />
                    <Text style={styles.actionBtnText}>Play Video</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.info.main }]}
                    onPress={() => Linking.openURL(item.linkUrl)}
                  >
                    <Icon name="open-in-new" size={16} color="#fff" />
                    <Text style={styles.actionBtnText}>Open in Browser</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.actionBtn} onPress={() => onOpenLink(item)}>
                  <Icon name="open-in-new" size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>Open Link</Text>
                </TouchableOpacity>
              )
            )}
            {item.type === 'text' && item.text && (
              <View style={styles.textBlock}>
                <Text style={styles.textBlockContent}>{item.text}</Text>
              </View>
            )}
            {item.type === 'file' && item.fileUrl && (() => {
              const ds = downloadState || { status: 'idle', progress: 0 };
              if (ds.status === 'downloading') {
                return (
                  <View style={styles.modalProgressContainer}>
                    <View style={styles.modalProgressTrack}>
                      <View style={[styles.modalProgressFill, { width: `${ds.progress}%` }]} />
                    </View>
                    <Text style={styles.modalProgressText}>Downloading… {ds.progress}%</Text>
                  </View>
                );
              }
              if (ds.status === 'downloaded') {
                const isVid = isDirectVideoUrl(item.fileUrl || '') || item.mimeType?.startsWith('video/');
                const localUrl = ds.localPath
                  ? (ds.localPath.startsWith('file://') ? ds.localPath : `file://${ds.localPath}`)
                  : '';
                return (
                  <View style={{ gap: 8, marginTop: 4 }}>
                    {isVid && localUrl ? (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: colors.danger.main }]}
                        onPress={() => onPlayVideo(item, localUrl)}
                      >
                        <Icon name="play" size={16} color="#fff" />
                        <Text style={styles.actionBtnText}>Play Video</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: colors.success.main }]}
                      onPress={() => onOpen(item)}
                    >
                      <Icon name="folder-open-outline" size={16} color="#fff" />
                      <Text style={styles.actionBtnText}>Open File</Text>
                    </TouchableOpacity>
                  </View>
                );
              }
              return (
                <TouchableOpacity style={styles.actionBtn} onPress={() => onDownload(item)}>
                  <Icon name={ds.status === 'error' ? 'reload' : 'download'} size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>{ds.status === 'error' ? 'Retry Download' : 'Download File'}</Text>
                </TouchableOpacity>
              );
            })()}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const UnitSectionHeader = ({ unitName, count, collapsed, onToggle }) => (
  <TouchableOpacity style={styles.unitSectionHeader} onPress={onToggle} activeOpacity={0.8}>
    <LinearGradient
      colors={[colors.primary.soft, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.unitSectionGradient}
    >
      <View style={styles.unitSectionLeft}>
        <Icon name="book-open-variant" size={16} color={colors.primary.main} />
        <Text style={styles.unitSectionTitle} numberOfLines={1}>{unitName}</Text>
      </View>
      <View style={styles.unitSectionRight}>
        <View style={styles.unitSectionBadge}>
          <Text style={styles.unitSectionBadgeText}>{count}</Text>
        </View>
        <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color={colors.primary.main} />
      </View>
    </LinearGradient>
  </TouchableOpacity>
);

const MaterialCard = ({ material, onPress, onDownload, onOpen, downloadState, unitNamesMap }) => {
  const iconInfo = getMaterialIconInfo(material);
  const ds = downloadState || { status: 'idle', progress: 0 };

  const renderFileAction = () => {
    if (ds.status === 'error') {
      return (
        <TouchableOpacity style={styles.downloadBtn} onPress={() => onDownload(material)}>
          <Icon name="reload" size={14} color={colors.danger.main} />
        </TouchableOpacity>
      );
    }
    if (ds.status === 'downloaded') {
      return (
        <TouchableOpacity style={styles.openBtn} onPress={() => onOpen(material)}>
          <Icon name="folder-open-outline" size={12} color="#fff" />
          <Text style={styles.openBtnText}>Open</Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity style={styles.downloadBtn} onPress={() => onDownload(material)}>
        <Icon name="download" size={14} color={colors.primary.main} />
      </TouchableOpacity>
    );
  };

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(material)} activeOpacity={0.8}>
      <View style={[styles.iconBox, { backgroundColor: iconInfo.bg }]}>
        <Icon name={iconInfo.icon} size={26} color={iconInfo.color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{material.title}</Text>
          <View style={styles.unitBadge}>
            <Text style={styles.unitBadgeText}>
              {resolveUnitName(unitNamesMap, material)}
            </Text>
          </View>
        </View>
        {material.description ? (
          <Text style={styles.cardDesc} numberOfLines={2}>{material.description}</Text>
        ) : null}
        <View style={styles.cardFooter}>
          {ds.status === 'downloading' ? (
            <>
              <Icon name="cloud-download" size={12} color={colors.primary.main} />
              <View style={styles.miniProgressTrack}>
                <View style={[styles.miniProgressFill, { width: `${ds.progress}%` }]} />
              </View>
              <Text style={styles.miniProgressPct}>{ds.progress}%</Text>
            </>
          ) : (
            <>
              <Icon name="clock-outline" size={12} color={colors.text.muted} />
              <Text style={styles.footerText}>{new Date(Number(material.createdAt) || material.createdAt).toLocaleDateString()}</Text>
              {material.type === 'file' && renderFileAction()}
            </>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const MaterialSkeleton = () => (
  <View style={[styles.card, { marginBottom: 12, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center' }]}>
    <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.bg.border, marginRight: 12 }} />
    <View style={{ flex: 1 }}>
      <View style={{ width: '65%', height: 14, backgroundColor: colors.bg.border, borderRadius: 4, marginBottom: 8 }} />
      <View style={{ width: '40%', height: 11, backgroundColor: colors.bg.border, borderRadius: 4, marginBottom: 6 }} />
      <View style={{ width: '30%', height: 10, backgroundColor: colors.bg.border, borderRadius: 4 }} />
    </View>
  </View>
);

export default function MaterialsScreen({ route }) {
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);
  const paramUnitId = route?.params?.selectedUnitId;
  const { enrolledUnits, unitNamesMap } = useEnrollment();
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [collapsedUnits, setCollapsedUnits] = useState({});
  const [detailVisible, setDetailVisible] = useState(false);
  const [selected, setSelected] = useState(null);
  const [downloadStates, setDownloadStates] = useState({});
  const [videoVisible, setVideoVisible] = useState(false);
  const [videoItem, setVideoItem] = useState(null);
  const [videoPlayUrl, setVideoPlayUrl] = useState('');
  const [pdfVisible, setPdfVisible] = useState(false);
  const [pdfItem, setPdfItem] = useState(null);
  const [pdfLocalPath, setPdfLocalPath] = useState(null);
  const [linkVisible, setLinkVisible] = useState(false);
  const [linkItem, setLinkItem] = useState(null);

  const handlePlayVideo = useCallback((item, url) => {
    setVideoItem(item);
    setVideoPlayUrl(url || item.linkUrl || item.fileUrl || '');
    setVideoVisible(true);
  }, []);

  const unitIds = useMemo(() => {
    if (paramUnitId) return [paramUnitId];
    return [...new Set((enrolledUnits || []).map(u => {
      const s = String(u || '').trim();
      const m = s.match(/\(([^)]+)\)/);
      return m ? m[1].replace(/\s+/g, '').toUpperCase() : s.toUpperCase();
    }).filter(Boolean))];
  }, [paramUnitId, enrolledUnits]);

  const toggleUnit = useCallback((unitCode) => {
    setCollapsedUnits(prev => ({ ...prev, [unitCode]: !prev[unitCode] }));
  }, []);

  const loadMaterials = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      // Fetch all units in parallel — no sequential waiting
      const results = await Promise.all(
        unitIds.map(uid =>
          fetchMaterials(uid)
            .then(data => Array.isArray(data) ? data.map(m => ({ ...m, _unitCode: uid })) : [])
            .catch(() => [])
        )
      );
      setMaterials(results.flat());
    } catch (err) {
      Alert.alert('Error', 'Failed to load materials');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [unitIds]);

  useFocusEffect(
    useCallback(() => { loadMaterials(); }, [loadMaterials]),
  );

  const getMimeType = (filename = '') => {
    const ext = filename.split('?')[0].split('.').pop().toLowerCase();
    const map = {
      pdf:  'application/pdf',
      doc:  'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls:  'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt:  'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt:  'text/plain',
      csv:  'text/csv',
      png:  'image/png',
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      gif:  'image/gif',
      mp4:  'video/mp4',
      mp3:  'audio/mpeg',
      zip:  'application/zip',
    };
    return map[ext] || 'application/octet-stream';
  };

  const handleDownload = async (material) => {
    if (!material.fileUrl) return;
    const id = String(material.id);
    if (downloadStates[id]?.status === 'downloading') return;
    if (downloadStates[id]?.status === 'downloaded') {
      handleOpen(material);
      return;
    }

    // Resolve relative URLs against the API base
    const resolvedUrl = material.fileUrl.startsWith('http')
      ? material.fileUrl
      : `${API_BASE_URL}${material.fileUrl.startsWith('/') ? '' : '/'}${material.fileUrl}`;

    const rawUrl = resolvedUrl.split('?')[0];
    const ext = rawUrl.split('.').pop().toLowerCase() || 'bin';
    const safeName = `mat_${id}_${material.title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)}.${ext}`;
    const destPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${safeName}`;

    setDownloadStates(prev => ({ ...prev, [id]: { status: 'downloading', progress: 0, localPath: null } }));
    try {
      const session = await getStudentSession();
      const headers = session?.token ? { Authorization: `Bearer ${session.token}` } : {};

      await ReactNativeBlobUtil
        .config({ path: destPath, overwrite: true })
        .fetch('GET', resolvedUrl, headers)
        .progress({ interval: 150 }, (received, total) => {
          if (total > 0) {
            setDownloadStates(prev => ({
              ...prev,
              [id]: { ...prev[id], progress: Math.round((received / total) * 100) },
            }));
          }
        });
      setDownloadStates(prev => ({
        ...prev,
        [id]: { status: 'downloaded', progress: 100, localPath: destPath },
      }));
    } catch (err) {
      setDownloadStates(prev => ({ ...prev, [id]: { status: 'error', progress: 0, localPath: null } }));
      Alert.alert('Download failed', err.message || 'Please check your connection and try again.');
    }
  };

  const handleOpenLink = useCallback((item) => {
    setLinkItem(item);
    setLinkVisible(true);
  }, []);

  const handleOpen = async (material) => {
    const id = String(material.id);
    const localPath = downloadStates[id]?.localPath;
    if (!localPath) return;
    const isPdf = /\.pdf(\?|$)/i.test(localPath) || material.mimeType?.includes('pdf');
    if (isPdf) {
      setPdfItem(material);
      setPdfLocalPath(localPath);
      setPdfVisible(true);
      return;
    }
    const mimeType = getMimeType(localPath);
    try {
      if (Platform.OS === 'android') {
        await ReactNativeBlobUtil.android.actionViewIntent(localPath, mimeType);
      } else {
        await ReactNativeBlobUtil.ios.openDocument(localPath);
      }
    } catch {
      Alert.alert('Cannot open', 'No app found that can open this file type.');
    }
  };

  const filtered = useMemo(() => {
    let list = materials;
    if (typeFilter !== 'all') list = list.filter(m => m.type === typeFilter);
    if (search) list = list.filter(m =>
      m.title?.toLowerCase().includes(search.toLowerCase()) ||
      m.description?.toLowerCase().includes(search.toLowerCase())
    );
    return list.sort((a, b) => new Date(Number(b.createdAt) || b.createdAt) - new Date(Number(a.createdAt) || a.createdAt));
  }, [materials, typeFilter, search]);

  const sections = useMemo(() => {
    const groups = {};
    filtered.forEach(m => {
      const unitCode = m._unitCode || m.unitCode || m.unitId || '—';
      if (!groups[unitCode]) groups[unitCode] = [];
      groups[unitCode].push(m);
    });
    return Object.entries(groups).map(([unitCode, items]) => ({
      unitCode,
      unitName: unitNamesMap?.[unitCode] ? toTitleCase(String(unitNamesMap[unitCode])) : unitCode,
      count: items.length,
      collapsed: !!collapsedUnits[unitCode],
      data: collapsedUnits[unitCode] ? [] : items,
    }));
  }, [filtered, unitNamesMap, collapsedUnits]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg.screen} />

      {/* ── Header ── */}
      <LinearGradient colors={['#0D2818', colors.bg.screen]} style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="arrow-left" size={22} color="#F1F5F9" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.screenHeaderTitle}>Course Materials</Text>
          <Text style={styles.screenHeaderSub}>Notes, files and resources from your lecturers</Text>
        </View>
        <View style={styles.screenHeaderIcon}>
          <Icon name="book-open-variant" size={22} color="#10B981" />
        </View>
      </LinearGradient>

      {/* Search + Filters */}
      <View style={styles.filterBar}>
        <View style={styles.searchRow}>
          <Icon name="magnify" size={20} color={colors.text.muted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search materials..."
            placeholderTextColor={colors.text.muted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-circle" size={18} color={colors.text.muted} /></TouchableOpacity> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {TYPE_FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, typeFilter === f.key && styles.filterChipActive]}
              onPress={() => setTypeFilter(f.key)}
            >
              <Icon name={f.icon} size={14} color={typeFilter === f.key ? '#fff' : colors.text.secondary} />
              <Text style={[styles.filterLabel, typeFilter === f.key && styles.filterLabelActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ padding: 16 }}>
          {[1, 2, 3].map((_, i) => <MaterialSkeleton key={i} />)}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadMaterials(true)} colors={[colors.primary.main]} />}
          renderSectionHeader={({ section }) => (
            <UnitSectionHeader
              unitName={section.unitName}
              count={section.count}
              collapsed={section.collapsed}
              onToggle={() => toggleUnit(section.unitCode)}
            />
          )}
          renderItem={({ item }) => (
            <MaterialCard
              material={item}
              onPress={m => { setSelected(m); setDetailVisible(true); recordMaterialView(m.id); }}
              onDownload={handleDownload}
              onOpen={handleOpen}
              downloadState={downloadStates[String(item.id)]}
              unitNamesMap={unitNamesMap}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="folder-open-outline" size={56} color={colors.bg.border} />
              <Text style={styles.emptyTitle}>No materials found</Text>
              <Text style={styles.emptyText}>Materials shared by your lecturer will appear here</Text>
            </View>
          }
        />
      )}

      <DetailModal
        visible={detailVisible}
        item={selected}
        onClose={() => setDetailVisible(false)}
        onDownload={handleDownload}
        onOpen={handleOpen}
        onOpenLink={handleOpenLink}
        onPlayVideo={handlePlayVideo}
        downloadState={selected ? downloadStates[String(selected.id)] : null}
        unitNamesMap={unitNamesMap}
      />

      <PdfViewerModal
        visible={pdfVisible}
        item={pdfItem}
        localPath={pdfLocalPath}
        onClose={() => setPdfVisible(false)}
      />
      <LinkViewerModal
        visible={linkVisible}
        item={linkItem}
        onClose={() => setLinkVisible(false)}
      />
      <VideoPlayerModal
        visible={videoVisible}
        item={videoItem}
        url={videoPlayUrl}
        onClose={() => setVideoVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.screen },
  filterBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, gap: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.card, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.bg.border },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.text.primary },
  filterRow: { marginBottom: 12 },
  filterChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.bg.border, marginRight: 8 },
  filterChipActive: { backgroundColor: colors.primary.main, borderColor: colors.primary.main },
  filterLabel: { fontSize: 12, color: colors.text.secondary, marginLeft: 5, fontWeight: '600' },
  filterLabelActive: { color: '#fff' },
  listContent: { padding: 16, paddingTop: 4 },
  card: { flexDirection: 'row', backgroundColor: colors.bg.card, borderRadius: 16, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: colors.bg.border, alignItems: 'flex-start' },
  iconBox: { width: 50, height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text.primary },
  unitBadge: { backgroundColor: colors.primary.soft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 8 },
  unitBadgeText: { color: colors.primary.main, fontSize: 11, fontWeight: '600' },
  cardDesc: { fontSize: 13, color: colors.text.secondary, lineHeight: 18, marginBottom: 6 },
  cardFooter: { flexDirection: 'row', alignItems: 'center' },
  footerText: { fontSize: 12, color: colors.text.muted, marginLeft: 4, flex: 1 },
  downloadBtn: { padding: 4 },
  miniProgressTrack: { flex: 1, height: 3, backgroundColor: colors.bg.border, borderRadius: 2, marginHorizontal: 8, overflow: 'hidden' },
  miniProgressFill: { height: 3, backgroundColor: colors.primary.main, borderRadius: 2 },
  miniProgressPct: { fontSize: 10, color: colors.primary.main, fontWeight: '700', minWidth: 24 },
  openBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.success.main, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, gap: 3 },
  openBtnText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  modalProgressContainer: { marginTop: 12, padding: 14, backgroundColor: colors.bg.screen, borderRadius: 12 },
  modalProgressTrack: { height: 6, backgroundColor: colors.bg.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  modalProgressFill: { height: 6, backgroundColor: colors.primary.main, borderRadius: 3 },
  modalProgressText: { fontSize: 13, color: colors.primary.main, textAlign: 'center', fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text.secondary, marginTop: 16 },
  emptyText: { fontSize: 14, color: colors.text.muted, marginTop: 6, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  screenHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  screenHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#F1F5F9', marginBottom: 2 },
  screenHeaderSub: { fontSize: 12, color: '#94A3B8' },
  screenHeaderIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(16,185,129,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)' },
  modalSheet: { backgroundColor: colors.bg.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  modalHandle: { width: 40, height: 4, backgroundColor: colors.bg.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  modalIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text.primary },
  detailSection: { marginBottom: 12, flex: 1 },
  detailRow: { flexDirection: 'row', gap: 16 },
  detailLabel: { fontSize: 12, fontWeight: '700', color: colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  detailValue: { fontSize: 14, color: colors.text.primary },
  actionBtn: { backgroundColor: colors.primary.main, borderRadius: 12, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8 },
  textBlock: { backgroundColor: colors.bg.screen, borderRadius: 12, padding: 14, marginTop: 8 },
  textBlockContent: { fontSize: 14, color: colors.text.primary, lineHeight: 22 },
  // Unit section headers
  unitSectionHeader: {
    marginBottom: 6,
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primary.soft,
  },
  unitSectionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  unitSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  unitSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary.main,
    flex: 1,
  },
  unitSectionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unitSectionBadge: {
    backgroundColor: colors.primary.main,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  unitSectionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  // Video player
  videoModal: { flex: 1, backgroundColor: '#000' },
  videoModalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 52,
    paddingBottom: 12,
  },
  videoModalTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff', marginRight: 8 },
  videoCloseBtn: { padding: 6 },
  videoPlayer: { flex: 1, backgroundColor: '#000' },
  videoLoading: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  youtubeContainer: { width: '100%', backgroundColor: '#000', paddingVertical: 8 },
});
