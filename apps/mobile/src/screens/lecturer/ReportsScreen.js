import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Animated, Modal, 
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Pdf from 'react-native-pdf';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getLecturerSession } from '../../utils/authSession';
import { fetchMyLecturerTimetable } from '../../utils/lecturerTimetableApi';
import { API_BASE_URL } from '../../utils/constants';
import useResponsive from '../../hooks/useResponsive';
import useInternetStatus from '../../hooks/useInternetStatus';
import OfflineBanner from '../../components/OfflineBanner';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { generatePDF } from 'react-native-html-to-pdf';
import colors from '../../theme/colors';


const { width: SCREEN_WIDTH } = Dimensions.get('window');


const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

const FONT_SIZE = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  xxxl: 24,
};

// Touch target minimum size (accessibility)
const MIN_TOUCH_SIZE = 44;

const COLORS = {
  primary:         colors.primary.main,
  primaryLight:    colors.primary.light,
  success:         colors.success.main,
  warning:         colors.warning.main,
  danger:          colors.danger.main,
  info:            colors.info.main,
  teal:            colors.teal.main,
  purple:          colors.purple.main,
  bg:              colors.background.primary,
  surface:         colors.surface.primary,
  surfaceElevated: colors.surface.secondary,
  border:          colors.border.medium,
  borderLight:     colors.border.light,
  textPrimary:     colors.text.primary,
  textSecondary:   colors.text.secondary,
  textMuted:       colors.text.muted,
};

// ============================================================================
// CONSTANTS
// ============================================================================
const PERIODS = [
  { key: 'weekly', label: 'Weekly', icon: 'calendar-week', desc: 'Last 7 days', daysBack: 7 },
  { key: 'monthly', label: 'Monthly', icon: 'calendar-month', desc: 'Last 30 days', daysBack: 30 },
  { key: 'semester', label: 'Semester', icon: 'calendar-text', desc: 'Full semester', daysBack: null }, // Dynamic
];

const REPORT_TYPES = [
  { key: 'attendance', title: 'Attendance Report', description: 'Per-unit attendance rates and student-level breakdowns.', icon: 'account-check', color: COLORS.success },
  { key: 'performance', title: 'Unit Performance', description: 'Session completion rates and lesson type distribution.', icon: 'chart-bar', color: COLORS.primary },
  { key: 'assignments', title: 'Assignment Summary', description: 'Submission rates, late submissions, and grade distribution.', icon: 'clipboard-text-outline', color: COLORS.warning },
  { key: 'students', title: 'Student Progress', description: 'At-risk identification and engagement metrics.', icon: 'school-outline', color: COLORS.info },
  { key: 'sessions', title: 'Session Log', description: 'Audit log of conducted, cancelled, and rescheduled sessions.', icon: 'history', color: COLORS.teal },
  { key: 'comprehensive', title: 'Comprehensive Report', description: 'All reports combined into one overview document.', icon: 'file-chart', color: COLORS.purple },
];

const FORMAT_OPTIONS = [
  { key: 'pdf', label: 'PDF', icon: 'file-pdf-box', color: COLORS.danger },
  { key: 'csv', label: 'CSV', icon: 'file-delimited', color: COLORS.success },
  { key: 'excel', label: 'Excel', icon: 'microsoft-excel', color: '#16A34A' },
];

const REPORTS_CACHE_KEY = 'markwise.lecturer.reports.v2';
const SEMESTER_DAYS_KEY = 'markwise.semester.days';

// ============================================================================
// ERROR BOUNDARY COMPONENT
// ============================================================================
class PDFErrorBoundary extends React.Component {
  state = { hasError: false };
  
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ============================================================================
// SKELETON COMPONENTS
// ============================================================================
const SkeletonRecentRow = () => (
  <View style={styles.recentRow}>
    <View style={[styles.recentIconWrap, { backgroundColor: `${COLORS.primary}18`, opacity: 0.5 }]} />
    <View style={styles.recentInfo}>
      <View style={[styles.skeletonText, { width: 120, height: 14, marginBottom: 4 }]} />
      <View style={[styles.skeletonText, { width: 80, height: 10 }]} />
    </View>
    <View style={[styles.skeletonText, { width: 40, height: 20, borderRadius: 6 }]} />
  </View>
);

// ============================================================================
// PROGRESS MODAL
// ============================================================================
const ProgressModal = ({ visible, progress, message }) => (
  <Modal visible={visible} transparent animationType="fade">
    <View style={styles.progressOverlay}>
      <View style={styles.progressCard}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.progressMessage}>{message}</Text>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
      </View>
    </View>
  </Modal>
);

// ============================================================================
// SUMMARY STAT COMPONENT (improved touch target)
// ============================================================================
const SummaryStat = ({ icon, value, label, color, loading }) => (
  <View style={styles.summaryStatCard}>
    <View style={[styles.summaryStatIcon, { backgroundColor: `${color}18` }]}>
      <Icon name={icon} size={20} color={color} />
    </View>
    {loading ? (
      <>
        <View style={[styles.skeletonText, { width: 40, height: 16, marginVertical: 4 }]} />
        <View style={[styles.skeletonText, { width: 50, height: 10 }]} />
      </>
    ) : (
      <>
        <Text style={styles.summaryStatValue}>{value}</Text>
        <Text style={styles.summaryStatLabel}>{label}</Text>
      </>
    )}
  </View>
);

// ============================================================================
// REPORT VIEWER MODAL (with error boundary)
// ============================================================================
const PDFViewerFallback = ({ onOpenExternal }) => (
  <View style={styles.viewerCenter}>
    <Icon name="alert-circle-outline" size={48} color={COLORS.danger} />
    <Text style={styles.viewerHint}>PDF viewer encountered an error.</Text>
    <TouchableOpacity style={styles.viewerOpenBtn} onPress={onOpenExternal}>
      <Icon name="open-in-new" size={16} color="#fff" />
      <Text style={styles.viewerOpenBtnText}>Open externally</Text>
    </TouchableOpacity>
  </View>
);

const ReportViewerModal = ({ report, onClose }) => {
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState(false);
  const [authToken, setAuthToken] = useState(null);
  const isMounted = useRef(true);
  
  const isPDF = report?.format?.toLowerCase() === 'pdf';
  const isLocal = report?.fileUrl?.startsWith('file://') ?? false;
  const typeKey = report?.types?.[0] || 'attendance';
  const title = REPORT_TYPES.find(r => r.key === typeKey)?.title || 'Report';

  useEffect(() => {
    isMounted.current = true;
    getLecturerSession().then(s => {
      if (isMounted.current) {
        setAuthToken(s?.token || null);
        // Reset PDF error so the viewer retries with the auth token
        if (!isLocal) {
          setPdfLoading(true);
          setPdfError(false);
        }
      }
    }).catch(() => {});
    
    return () => { isMounted.current = false; };
  }, [isLocal]);

  useEffect(() => {
    if (isMounted.current) {
      setPdfLoading(true);
      setPdfError(false);
    }
  }, [report?.id]);

  const openExternal = async () => {
    if (!report?.fileUrl) return;
    const mimeType = isPDF ? 'application/pdf'
      : report.format === 'excel' ? 'application/vnd.ms-excel'
      : 'text/csv';
    try {
      if (isLocal) {
        // Validate existence first — file may have been cleared from cache/storage
        const stripped = String(report.fileUrl).trim().replace(/^(file:\/\/)+/, '');
        const absPath = stripped.startsWith('/') ? stripped : `/${stripped}`;
        const exists = await RNFS.exists(absPath);
        if (!exists) {
          Alert.alert('File Not Found', 'The report file is no longer on this device. Please regenerate the report.');
          return;
        }
        const ext = (absPath.split('.').pop() || 'tmp').split('?')[0].split('#')[0];
        const cachePath = `${RNFS.CachesDirectoryPath}/MarkWise_share_${Date.now()}.${ext}`;
        await RNFS.copyFile(absPath, cachePath);
        await Share.open({ url: `file://${cachePath}`, type: mimeType, failOnCancel: false });
      } else {
        // Download to cache then share
        const ext = isPDF ? 'pdf' : report.format === 'excel' ? 'xlsx' : 'csv';
        const cachePath = `${RNFS.CachesDirectoryPath}/MarkWise_share_${Date.now()}.${ext}`;
        const dlResult = await RNFS.downloadFile({
          fromUrl: report.fileUrl,
          toFile: cachePath,
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        }).promise;
        if (!dlResult || dlResult.statusCode < 200 || dlResult.statusCode >= 300) {
          throw new Error(`Download failed (HTTP ${dlResult?.statusCode ?? 'unknown'}). The report link may have expired — please regenerate.`);
        }
        await Share.open({ url: `file://${cachePath}`, type: mimeType, failOnCancel: false });
      }
    } catch (e) {
      if (String(e?.message).toLowerCase().includes('cancel')) return;
      Alert.alert('Cannot open', 'Unable to share this file on your device.');
    }
  };

  const pdfSource = useMemo(() => ({
    uri: report?.fileUrl || '',
    cache: !isLocal,
    ...(authToken && !isLocal && { headers: { Authorization: `Bearer ${authToken}` } }),
  }), [report?.fileUrl, isLocal, authToken]);


  if (!report) return null;

  return (
    <Modal visible={!!report} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.viewerContainer}>
        <View style={styles.viewerHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Close report">
            <Icon name="close" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.viewerTitle} numberOfLines={1}>{title}</Text>
          <TouchableOpacity onPress={openExternal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Share / download report">
            <Icon name="share-variant" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {isPDF && !pdfError ? (
          <PDFErrorBoundary fallback={<PDFViewerFallback onOpenExternal={openExternal} />}>
            <View style={{ flex: 1 }}>
              <Pdf
                trustAllCerts={false}
                source={pdfSource}
                style={styles.pdfViewer}
                onLoadComplete={() => { if (isMounted.current) setPdfLoading(false); }}
                onError={() => { if (isMounted.current) { setPdfLoading(false); setPdfError(true); } }}
              />
              {pdfLoading && (
                <View style={styles.pdfLoadingOverlay}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={[styles.viewerHint, { marginTop: SPACING.md }]}>Loading report…</Text>
                </View>
              )}
            </View>
          </PDFErrorBoundary>
        ) : !isPDF ? (
          <View style={styles.viewerCenter}>
            <Icon name={report.format === 'excel' ? 'file-excel-outline' : 'file-delimited-outline'} size={64} color={FORMAT_OPTIONS.find(f => f.key === report.format)?.color || COLORS.primary} />
            <Text style={styles.viewerHint}>{report.format?.toUpperCase()} files cannot be previewed in-app.</Text>
            <TouchableOpacity style={styles.viewerOpenBtn} onPress={openExternal}>
              <Icon name={isLocal ? 'share-variant' : 'open-in-new'} size={16} color="#fff" />
              <Text style={styles.viewerOpenBtnText}>{isLocal ? 'Share / Open with…' : 'Open with…'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <PDFViewerFallback />
        )}
      </SafeAreaView>
    </Modal>
  );
};

// ============================================================================
// RECENT REPORT ROW (with share / download / delete actions)
// ============================================================================
const RecentReportRow = ({ report, onOpen, onDelete, onShare, onDownload }) => {
  const typeKey = report.types?.[0] || 'attendance';
  const reportType = REPORT_TYPES.find(r => r.key === typeKey);
  const icon = reportType?.icon || 'file-chart';
  const color = reportType?.color || COLORS.primary;
  const formatColor = FORMAT_OPTIONS.find(f => f.key === report.format)?.color || COLORS.primary;
  const label = report.types.length > 1 ? `${report.types.length} reports` : (reportType?.title || 'Report');
  const period = PERIODS.find(p => p.key === report.period)?.label || report.period;
  // Download is available for ALL reports: remote ones pull from the server;
  // local file:// ones export a copy to external app storage (Files app visible).
  const canDownload = !!report.fileUrl;

  return (
    <View style={styles.recentRow}>
      {/* Main tap area — opens in-app viewer */}
      <TouchableOpacity
        style={styles.recentRowTouchable}
        onPress={() => report.fileUrl && onOpen(report)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`View ${label} report`}
      >
        <View style={[styles.recentIconWrap, { backgroundColor: `${color}18` }]}>
          <Icon name={icon} size={18} color={color} />
        </View>
        <View style={styles.recentInfo}>
          <Text style={styles.recentTitle} numberOfLines={1}>{label}</Text>
          <Text style={styles.recentMeta}>{report.department ? `${report.department} · ` : ''}{period} · {report.generatedAt}</Text>
        </View>
        <View style={[styles.recentFormatBadge, { backgroundColor: `${formatColor}18` }]}>
          <Text style={[styles.recentFormatText, { color: formatColor }]}>{report.format?.toUpperCase()}</Text>
        </View>
      </TouchableOpacity>

      {/* Action icon buttons */}
      <View style={styles.recentRowActions}>
        {/* Share: for local files opens share sheet; for remote downloads to temp then shares */}
        <TouchableOpacity
          style={styles.recentActionBtn}
          onPress={() => onShare(report)}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          accessibilityLabel="Share report"
          accessibilityRole="button"
        >
          <Icon name="share-variant-outline" size={18} color={COLORS.primary} />
        </TouchableOpacity>

        {/* Download: export to external app storage — shown for all reports */}
        {canDownload && (
          <TouchableOpacity
            style={styles.recentActionBtn}
            onPress={() => onDownload(report)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            accessibilityLabel="Download report to device"
            accessibilityRole="button"
          >
            <Icon name="download-outline" size={18} color={COLORS.info} />
          </TouchableOpacity>
        )}

        {/* Delete */}
        <TouchableOpacity
          style={styles.recentActionBtn}
          onPress={() => onDelete(report.id)}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          accessibilityLabel="Delete report"
          accessibilityRole="button"
        >
          <Icon name="trash-can-outline" size={18} color={COLORS.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ============================================================================
// MAIN SCREEN
// ============================================================================
export default function ReportsScreen() {
  const { isTablet, isDesktop, contentMaxWidth } = useResponsive();
  const { isOnline } = useInternetStatus();

  // State
  const [selectedPeriod, setSelectedPeriod] = useState('monthly');
  const [selectedTypes, setSelectedTypes] = useState(new Set(['attendance']));
  const [selectedFormat, setSelectedFormat] = useState('pdf');
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [units, setUnits] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(true);
  const [summaryStats, setSummaryStats] = useState({ units: 0, students: 0, sessions: 0, assignments: 0, avgAttendance: null });
  const [recentReports, setRecentReports] = useState([]);
  const [viewingReport, setViewingReport] = useState(null);
  const [semesterDays, setSemesterDays] = useState(112);
  const [fadeAnim] = useState(new Animated.Value(0));
  const generationAbortRef = useRef(null);
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [selectedUnit, setSelectedUnit] = useState('all');

  // Load semester days from storage
  useEffect(() => {
    AsyncStorage.getItem(SEMESTER_DAYS_KEY).then(value => {
      if (value) setSemesterDays(parseInt(value, 10));
    }).catch(() => {});
  }, []);

  // Load recent reports
  const loadRecentReports = useCallback(async () => {
    setRecentLoading(true);
    try {
      const raw = await AsyncStorage.getItem(REPORTS_CACHE_KEY);
      if (raw) setRecentReports(JSON.parse(raw));
    } catch {
      // Silent fail
    } finally {
      setRecentLoading(false);
    }
  }, []);

  // Save report to cache
  const saveReport = useCallback(async (record) => {
    try {
      const updated = [record, ...recentReports].slice(0, 20);
      setRecentReports(updated);
      await AsyncStorage.setItem(REPORTS_CACHE_KEY, JSON.stringify(updated));
    } catch {
      // Silent fail - cache is non-critical
    }
  }, [recentReports]);

  // Normalise a local file path or URI into a single clean file:// URI.
  // Guards against double prefixes ("file://file:///...") that some versions
  // of react-native-html-to-pdf emit on specific Android releases.
  const toSafeFileUri = useCallback((raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    // Strip ALL file:// prefixes (some Android releases double it)
    const stripped = s.replace(/^(file:\/\/)+/, '');
    // Ensure the path is absolute (some versions return a relative path)
    const absolute = stripped.startsWith('/') ? stripped : `/${stripped}`;
    return `file://${absolute}`;
  }, []);

  // Copy a local file:// URI to the app's INTERNAL CACHE directory before sharing.
  //
  // Why this is necessary on Android:
  // react-native-share v12 uses its own FileProvider subclass (cl.json.RNShareFileProvider)
  // with authority "<packageId>.rnshare.fileprovider". Its bundled
  // share_download_paths.xml only declares:
  //   <external-path path="Download/" />  — public Downloads folder
  //   <cache-path     path="/"       />  — internal cache directory
  // Files written to DocumentDirectoryPath (internal files-path) are NOT covered,
  // so FileProvider.getUriForFile() returns null → getScheme() throws NPE.
  //
  // Copying to CachesDirectoryPath before sharing works because cache-path IS
  // covered, the library converts it to a valid content:// URI, and the share
  // sheet can deliver the file to any receiving app.
  const copyToShareCache = useCallback(async (fileUri) => {
    if (!fileUri) return null;
    const stripped = String(fileUri).trim().replace(/^(file:\/\/)+/, '');
    // Ensure the stripped path is absolute
    const srcPath = stripped.startsWith('/') ? stripped : `/${stripped}`;
    const exists = await RNFS.exists(srcPath);
    if (!exists) {
      throw new Error('Report file not found on this device. Please regenerate the report.');
    }
    const ext = (srcPath.split('.').pop() || 'tmp').split('?')[0].split('#')[0];
    const cachePath = `${RNFS.CachesDirectoryPath}/MarkWise_share_${Date.now()}.${ext}`;
    await RNFS.copyFile(srcPath, cachePath);
    return `file://${cachePath}`;
  }, []);

  // Share a report — copies local files to cache first (see copyToShareCache),
  // or downloads remote URLs to cache then shares.
  const shareReport = useCallback(async (report) => {
    if (!report.fileUrl) {
      Alert.alert('Unavailable', 'This report has no file associated.');
      return;
    }
    const mimeType = report.format === 'pdf' ? 'application/pdf'
      : report.format === 'excel' ? 'application/vnd.ms-excel'
      : 'text/csv';
    try {
      if (report.fileUrl.startsWith('file://')) {
        // copyToShareCache validates existence and throws with a clear message if missing
        const cacheUri = await copyToShareCache(report.fileUrl);
        if (!cacheUri) throw new Error('Invalid file path');
        await Share.open({ url: cacheUri, type: mimeType, failOnCancel: false });
      } else {
        const ext = report.format === 'pdf' ? 'pdf' : report.format === 'excel' ? 'xlsx' : 'csv';
        const cachePath = `${RNFS.CachesDirectoryPath}/MarkWise_share_${Date.now()}.${ext}`;
        const session = await getLecturerSession();
        const dlResult = await RNFS.downloadFile({
          fromUrl: report.fileUrl,
          toFile: cachePath,
          headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
        }).promise;
        if (!dlResult || dlResult.statusCode < 200 || dlResult.statusCode >= 300) {
          throw new Error(`Download failed (HTTP ${dlResult?.statusCode ?? 'unknown'}). The report link may have expired — please regenerate.`);
        }
        await Share.open({ url: `file://${cachePath}`, type: mimeType, failOnCancel: false });
      }
    } catch (e) {
      if (String(e?.message).toLowerCase().includes('cancel')) return;
      Alert.alert('Share Failed', e?.message || 'Could not share the report. Please try again.');
    }
  }, [copyToShareCache]);

  // Download a report to external app storage (visible in Files app, no permissions needed).
  // For remote reports this also updates the cached URL to the local path for offline access.
  // For local file:// reports this exports a copy to an externally-accessible location.
  const downloadReport = useCallback(async (report) => {
    if (!report.fileUrl) return;
    const ext = report.format === 'pdf' ? 'pdf' : report.format === 'excel' ? 'xlsx' : 'csv';
    const filename = `MarkWise_Report_${report.period}_${Date.now()}.${ext}`;
    // ExternalDirectoryPath = getExternalFilesDir(null) — app-specific, no WRITE_EXTERNAL_STORAGE
    // needed on any Android version, visible to the user in Files app under
    // Android/data/com.markwise/files/
    const downloadDir = RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath;
    const destPath = `${downloadDir}/${filename}`;
    const mimeType = report.format === 'pdf' ? 'application/pdf'
      : report.format === 'excel' ? 'application/vnd.ms-excel'
      : 'text/csv';
    try {
      if (report.fileUrl.startsWith('file://')) {
        // Already on device — validate it exists, then export a copy to external app storage.
        const source = String(report.fileUrl).trim().replace(/^(file:\/\/)+/, '');
        const absSource = source.startsWith('/') ? source : `/${source}`;
        const srcExists = await RNFS.exists(absSource);
        if (!srcExists) {
          throw new Error('Report file not found on this device. Please regenerate the report.');
        }
        await RNFS.copyFile(absSource, destPath);
      } else {
        // Remote URL — download directly to external app storage.
        const session = await getLecturerSession();
        const dlResult = await RNFS.downloadFile({
          fromUrl: report.fileUrl,
          toFile: destPath,
          headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
        }).promise;
        if (!dlResult || dlResult.statusCode < 200 || dlResult.statusCode >= 300) {
          throw new Error(`Download failed (HTTP ${dlResult?.statusCode ?? 'unknown'}). The report link may have expired — please regenerate.`);
        }
        // Persist the local path so the report opens offline from now on.
        const localUrl = `file://${destPath}`;
        const updated = recentReports.map(r =>
          r.id === report.id ? { ...r, fileUrl: localUrl } : r,
        );
        setRecentReports(updated);
        AsyncStorage.setItem(REPORTS_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
      }
      Alert.alert(
        'Saved',
        `${filename} saved. Find it in the Files app under Android › data › com.markwise › files.`,
        [
          { text: 'Share', onPress: () =>
              copyToShareCache(`file://${destPath}`)
                .then(cacheUri => Share.open({ url: cacheUri, type: mimeType, failOnCancel: false }))
                .catch(e => Alert.alert('Share Failed', e?.message || 'Could not share the file.'))
          },
          { text: 'OK' },
        ],
      );
    } catch (e) {
      Alert.alert('Save Failed', e?.message || 'Could not save the report. Please try again.');
    }
  }, [recentReports, copyToShareCache]);

  // Delete a report from the recent list (and its local file if applicable)
  const deleteReport = useCallback(async (reportId) => {
    Alert.alert(
      'Delete Report',
      'Remove this report from your recent list?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const report = recentReports.find(r => r.id === reportId);
            // Delete local file if it exists
            if (report?.fileUrl?.startsWith('file://')) {
              const path = report.fileUrl.replace('file://', '');
              RNFS.exists(path).then(exists => {
                if (exists) RNFS.unlink(path).catch(() => {});
              }).catch(() => {});
            }
            const updated = recentReports.filter(r => r.id !== reportId);
            setRecentReports(updated);
            try {
              await AsyncStorage.setItem(REPORTS_CACHE_KEY, JSON.stringify(updated));
            } catch {
              // Silent fail
            }
          },
        },
      ],
    );
  }, [recentReports]);

  // Load data (only on mount, not every focus)
  useEffect(() => {
    let isMounted = true;
    
    const loadData = async () => {
      setStatsLoading(true);
      try {
        const session = await getLecturerSession();
        if (!isMounted) return;
        
        const tt = await fetchMyLecturerTimetable(session.token);
        const timetableList = Array.isArray(tt) ? tt : [];
        
        const uniqueUnitsMap = new Map();
        const deptMap = new Map();
        for (const entry of timetableList) {
          if (entry.unitCode && !uniqueUnitsMap.has(entry.unitCode)) {
            const unitEntry = {
              unitCode: entry.unitCode,
              unitName: entry.unitName || entry.unitTitle || entry.unitCode,
            };
            uniqueUnitsMap.set(entry.unitCode, unitEntry);
            const deptName = entry.department || entry.departmentName || entry.department_name || 'General';
            if (!deptMap.has(deptName)) deptMap.set(deptName, new Map());
            deptMap.get(deptName).set(entry.unitCode, unitEntry);
          }
        }
        const unitList = Array.from(uniqueUnitsMap.values());
        setUnits(unitList);
        const deptList = Array.from(deptMap.entries()).map(([name, unitsMap]) => ({
          name,
          units: Array.from(unitsMap.values()),
        }));
        setDepartments(deptList);
        setSelectedDepartment(prev => prev || (deptList.length > 0 ? deptList[0].name : null));

        if (unitList.length > 0) {
          const unitCodes = unitList.map(u => u.unitCode);
          const res = await fetch(`${API_BASE_URL}/api/lecturer/analytics/batch`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ unitCodes }),
          });
          
          if (res.ok && isMounted) {
            const analytics = await res.json();
            // Normalise: handle all known field-name variants and 0-1 fraction rates
            const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
            const normEntry = (d) => {
              if (!d || typeof d !== 'object') return { students: 0, conductedSessions: 0, attendanceRate: 0, assignments: 0 };
              const students = safeNum(d.students ?? d.enrolledStudents ?? d.enrolled_students ?? d.enrolled ?? d.studentCount ?? d.student_count ?? d.totalStudents ?? d.total_students);
              const conductedSessions = safeNum(d.conductedSessions ?? d.conducted_sessions ?? d.sessionCount ?? d.session_count ?? d.totalSessions ?? d.total_sessions ?? d.conducted);
              const assignments = safeNum(d.assignments ?? d.assignmentCount ?? d.assignment_count ?? d.totalAssignments ?? d.total_assignments);
              let rawRate = safeNum(d.attendanceRate ?? d.attendance_rate ?? d.attendancePercent ?? d.attendance_percent ?? d.rate ?? d.percentage ?? d.percent);
              if (rawRate > 0 && rawRate <= 1) rawRate = rawRate * 100;
              return { students, conductedSessions, assignments, attendanceRate: Math.min(100, Math.round(rawRate)) };
            };
            let totalEnrollments = 0, totalSessions = 0, totalAssignments = 0, weightedAttSum = 0, weightTotal = 0;

            for (const code of unitCodes) {
              const raw = analytics[code] ?? analytics[code?.replace(/\s+/g, '')] ?? {};
              const d = normEntry(raw);
              totalEnrollments += d.students;
              totalSessions += d.conductedSessions;
              totalAssignments += d.assignments;
              if (d.attendanceRate > 0 && d.conductedSessions > 0) {
                weightedAttSum += d.attendanceRate * d.conductedSessions;
                weightTotal += d.conductedSessions;
              }
            }

            setSummaryStats({
              units: unitList.length,
              students: totalEnrollments,
              sessions: totalSessions,
              assignments: totalAssignments,
              avgAttendance: weightTotal > 0 ? Math.round(weightedAttSum / weightTotal) : null,
            });
          } else if (isMounted) {
            setSummaryStats({ units: unitList.length, students: 0, sessions: 0, assignments: 0, avgAttendance: null });
          }
        } else if (isMounted) {
          setSummaryStats({ units: 0, students: 0, sessions: 0, assignments: 0, avgAttendance: null });
        }
      } catch {
        if (isMounted) setSummaryStats(prev => prev);
      } finally {
        if (isMounted) setStatsLoading(false);
      }
    };

    loadData();
    loadRecentReports();
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    
    return () => { isMounted = false; };
  }, [loadRecentReports, fadeAnim]);

  // Toggle report type with minimum selection protection
  const toggleType = useCallback((key) => {
    setSelectedTypes(prev => {
      if (prev.has(key)) {
        if (prev.size === 1) {
          // Show feedback that at least one type must be selected
          Alert.alert('Selection Required', 'At least one report type must be selected.', [{ text: 'OK' }]);
          return prev;
        }
        const next = new Set(prev);
        next.delete(key);
        return next;
      }
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  // Derived lists based on department / unit selection
  const deptUnits = useMemo(() => {
    if (!selectedDepartment) return units;
    const dept = departments.find(d => d.name === selectedDepartment);
    return dept ? dept.units : units;
  }, [selectedDepartment, departments, units]);

  const reportUnitCodes = useMemo(() => {
    if (selectedUnit === 'all') return deptUnits.map(u => u.unitCode);
    const exists = deptUnits.some(u => u.unitCode === selectedUnit);
    return exists ? [selectedUnit] : deptUnits.map(u => u.unitCode);
  }, [selectedUnit, deptUnits]);

  // Generate attendance CSV with per-student per-session grid
  const generateAttendanceCSV = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const escapeCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

    const allLines = [];

    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;

      // Header block
      allLines.push(escapeCell('MARKWISE ATTENDANCE REPORT'));
      allLines.push(escapeCell(`Department: ${department || 'General'}`));
      allLines.push(escapeCell(`Unit: ${unitTitle} (${code})`));
      allLines.push(escapeCell(`Lecturer: ${lecturerName}`));
      allLines.push(escapeCell(`Period: ${PERIODS.find(p => p.key === period)?.label || period}`));
      allLines.push(escapeCell(`Generated: ${generatedStr}`));
      allLines.push('');

      // Fetch attendance grid
      let gridData = null;
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/lecturer/units/${encodeURIComponent(code)}/attendance/grid?startDate=${startDate}&endDate=${endDate}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) gridData = await res.json();
      } catch {}

      if (!gridData) {
        allLines.push(escapeCell('No attendance data available for this period.'));
        allLines.push('');
        allLines.push('');
        continue;
      }

      // Normalise response shape + deduplicate sessions and students
      const rawCsvSessions = (
        gridData.sessions ||
        gridData.lectureSlots ||
        gridData.lectureSessions ||
        gridData.slots ||
        []
      ).filter(Boolean);

      const rawCsvStudents = (
        gridData.students ||
        gridData.rows ||
        gridData.studentAttendance ||
        gridData.data ||
        []
      ).filter(Boolean);

      // Deduplicate sessions
      const seenCsvSessIds = new Set();
      const sessions = rawCsvSessions.filter(s => {
        if (!s || typeof s !== 'object') return true;
        const id = s.sessionId ?? s.id ?? s.session_id;
        if (id == null) return true;
        const k = String(id);
        if (seenCsvSessIds.has(k)) return false;
        seenCsvSessIds.add(k);
        return true;
      });

      // Deduplicate students
      const seenCsvStudentIds = new Map();
      const studentRows = [];
      for (const s of rawCsvStudents) {
        const sid = s.studentId ?? s.id ?? s.student_id ?? s.admissionNumber ?? s.adm_number ?? s.registration_number;
        if (sid == null) { studentRows.push(s); continue; }
        const k = String(sid);
        if (!seenCsvStudentIds.has(k)) {
          seenCsvStudentIds.set(k, studentRows.length);
          studentRows.push(s);
        }
      }

      const totalSessions = sessions.length;
      const totalStudents = studentRows.length;

      // Build per-student processed rows
      let overallPresent = 0;
      let below75Count = 0;

      const processed = studentRows.map(sr => {
        let attended = 0;
        const sessionPresence = sessions.map((sess, idx) => {
          let present = false;
          const sessId = sess.sessionId || sess.id || sess.session_id || idx;
          if (sr.records && typeof sr.records === 'object') {
            present = !!sr.records[sessId];
          } else if (Array.isArray(sr.attendance)) {
            present = !!sr.attendance[idx];
          } else if (Array.isArray(sr.sessions)) {
            present = !!sr.sessions[idx];
          } else if (Array.isArray(sr.present)) {
            present = !!sr.present[idx];
          }
          if (present) attended++;
          return present;
        });
        overallPresent += attended;
        const pct = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
        if (pct < 75) below75Count++;
        return {
          admNo: sr.admNo || sr.studentId || sr.reg_no || sr.admission_no || sr.admissionNo || '',
          name: sr.name || sr.studentName || sr.fullName || sr.full_name || '',
          sessionPresence,
          attended,
          pct,
        };
      });

      const avgAttendance = totalStudents > 0 && totalSessions > 0
        ? Math.round((overallPresent / (totalStudents * totalSessions)) * 100)
        : 0;

      // Summary block
      allLines.push(escapeCell('SUMMARY'));
      allLines.push(escapeCell(`Total Students Enrolled: ${totalStudents}`));
      allLines.push(escapeCell(`Total Sessions Held: ${totalSessions}`));
      allLines.push(escapeCell(`Average Attendance: ${avgAttendance}%`));
      allLines.push(escapeCell(`Below 75%: ${below75Count} students`));
      allLines.push('');

      // Grid header row
      const sessionLabels = sessions.map((s, i) =>
        escapeCell(s.label || s.slot_label || s.slotLabel || s.title || `LEC ${i + 1}`)
      );
      allLines.push([
        escapeCell('Adm No.'),
        escapeCell('Name'),
        ...sessionLabels,
        escapeCell('Total Sessions'),
        escapeCell('Sessions Attended'),
        escapeCell('Attendance (%)'),
      ].join(','));

      // Student rows
      for (const r of processed) {
        allLines.push([
          escapeCell(r.admNo),
          escapeCell(r.name),
          ...r.sessionPresence.map(p => escapeCell(p ? '\u2713' : '\u2717')),
          escapeCell(String(totalSessions)),
          escapeCell(String(r.attended)),
          escapeCell(`${r.pct}%`),
        ].join(','));
      }

      allLines.push('');
      allLines.push('');
    }

    const csv = allLines.join('\n');
    const filename = `MarkWise_Attendance_${period}_${Date.now()}.csv`;
    const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
    await RNFS.writeFile(path, csv, 'utf8');
    return path;
  }, []);

  // ── shared helper: fetch + normalise attendance grid for one unit ─────────
  const fetchAttendanceGrid = useCallback(async (token, code, startDate, endDate) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/lecturer/units/${encodeURIComponent(code)}/attendance/grid?startDate=${startDate}&endDate=${endDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // ── normalise a raw grid response into { sessions, studentRows } ──────────
  const normaliseGrid = useCallback((gridData) => {
    if (!gridData) return { sessions: [], studentRows: [] };
    const rawSessions = (
      gridData.sessions || gridData.lectureSlots || gridData.lectureSessions || gridData.slots ||
      gridData.lectureLabels || gridData.sessionLabels || gridData.lectures || gridData.labels || []
    ).filter(Boolean);
    const rawStudentRows = (
      gridData.students || gridData.rows || gridData.studentAttendance || gridData.data || []
    ).filter(Boolean);

    // Deduplicate sessions by ID — backend may emit the same session once per
    // attendance method (QR / BLE / manual) due to an un-grouped JOIN.
    const seenSessIds = new Set();
    const sessions = rawSessions.filter(s => {
      if (!s || typeof s !== 'object') return true;
      const id = s.sessionId ?? s.id ?? s.session_id;
      if (id == null) return true;
      const k = String(id);
      if (seenSessIds.has(k)) return false;
      seenSessIds.add(k);
      return true;
    });

    // Deduplicate students by ID — same cause as above.
    const seenStudentIds = new Map();
    const studentRows = [];
    for (const s of rawStudentRows) {
      const sid = s.studentId ?? s.id ?? s.student_id ?? s.admissionNumber ?? s.adm_number ?? s.registration_number;
      if (sid == null) { studentRows.push(s); continue; }
      const k = String(sid);
      if (!seenStudentIds.has(k)) {
        seenStudentIds.set(k, studentRows.length);
        studentRows.push(s);
      }
    }

    return { sessions, studentRows };
  }, []);

  // ── process a studentRow against sessions array ───────────────────────────
  const processStudentRows = useCallback((sessions, studentRows) => {
    // Extract session IDs for records-based lookup
    const sessionIds = sessions.map((s, i) => {
      if (s && typeof s === 'object') return s.sessionId ?? s.id ?? s.session_id ?? i;
      return i;
    });

    // Coerce any attendance value to boolean
    const resolveValue = (v) => {
      if (v === undefined || v === null) return false;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'object') {
        const inner = v.attended ?? v.present ?? v.status ?? v.value;
        if (inner !== undefined) return resolveValue(inner);
        return false;
      }
      const s = String(v).trim().toUpperCase();
      return s === 'P' || s === 'TRUE' || s === '1' || s === 'YES' || s === 'PRESENT';
    };

    const totalSessions = sessions.length;
    let overallPresent = 0;
    let below75Count = 0;
    const processed = studentRows.map(sr => {
      let attended = 0;
      const sessionPresence = sessions.map((sess, idx) => {
        const sessId = sessionIds[idx];
        let present = false;
        if (sr.records && typeof sr.records === 'object') {
          const v = sr.records[sessId] ?? sr.records[String(sessId)];
          if (v !== undefined) {
            present = resolveValue(v);
          } else {
            const arr = Array.isArray(sr.attendance) ? sr.attendance
              : Array.isArray(sr.sessions) ? sr.sessions
              : Array.isArray(sr.present) ? sr.present : null;
            present = arr ? resolveValue(arr[idx]) : false;
          }
        } else {
          const arr = Array.isArray(sr.attendance) ? sr.attendance
            : Array.isArray(sr.sessions) ? sr.sessions
            : Array.isArray(sr.present) ? sr.present : null;
          present = arr ? resolveValue(arr[idx]) : false;
        }
        if (present) attended++;
        return present;
      });
      overallPresent += attended;
      const pct = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
      if (pct < 75) below75Count++;
      return {
        admNo: sr.admNo || sr.admissionNumber || sr.adm_number || sr.admission_no ||
               sr.registration_number || sr.regNumber || sr.admissionNo || sr.studentId || '',
        name: sr.name || sr.studentName || sr.fullName || sr.full_name || '',
        sessionPresence,
        attended,
        pct,
      };
    });
    return { processed, overallPresent, below75Count };
  }, []);

  // Generate local PDF for attendance report
  const generateAttendancePDFLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let bodyHtml = '';

    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;

      const gridData = await fetchAttendanceGrid(token, code, startDate, endDate);
      const { sessions, studentRows } = normaliseGrid(gridData);
      const totalSessions = sessions.length;
      const totalStudents = studentRows.length;
      const { processed, overallPresent, below75Count } = processStudentRows(sessions, studentRows);
      const avgAttendance = totalStudents > 0 && totalSessions > 0
        ? Math.round((overallPresent / (totalStudents * totalSessions)) * 100)
        : 0;

      // Session header columns
      const sessionHeaders = sessions.map((s, i) =>
        `<th>${esc(s.label || s.slot_label || s.slotLabel || s.title || `LEC ${i + 1}`)}</th>`
      ).join('');

      // Student data rows
      const studentDataRows = processed.map(r => {
        const cells = r.sessionPresence.map(p =>
          p ? `<td class="present">&#10003;</td>` : `<td class="absent">&#10007;</td>`
        ).join('');
        const pctClass = r.pct < 75 ? 'pct-low' : 'pct-ok';
        return `<tr>
          <td class="td-left">${esc(r.admNo)}</td>
          <td class="td-left">${esc(r.name)}</td>
          ${cells}
          <td>${r.attended}</td>
          <td class="${pctClass}">${r.pct}%</td>
        </tr>`;
      }).join('');

      const noDataNotice = totalSessions === 0
        ? `<p style="color:#6b7280;font-style:italic;">No attendance data available for this period.</p>`
        : '';

      bodyHtml += `
        <div class="unit-block">
          <h1>MARKWISE ATTENDANCE REPORT</h1>
          <table class="meta-table">
            <tr><td><b>Department</b></td><td>${esc(department || 'General')}</td></tr>
            <tr><td><b>Unit</b></td><td>${esc(unitTitle)} (${esc(code)})</td></tr>
            <tr><td><b>Lecturer</b></td><td>${esc(lecturerName)}</td></tr>
            <tr><td><b>Period</b></td><td>${esc(PERIODS.find(p => p.key === period)?.label || period)}</td></tr>
            <tr><td><b>Generated</b></td><td>${generatedStr}</td></tr>
          </table>

          <div class="section-title">SUMMARY</div>
          <table class="summary-table">
            <tr><td>Total Students Enrolled</td><td><b>${totalStudents}</b></td></tr>
            <tr><td>Total Sessions Held</td><td><b>${totalSessions}</b></td></tr>
            <tr><td>Average Attendance</td><td><b>${avgAttendance}%</b></td></tr>
            <tr><td>Below 75% Attendance</td><td><b>${below75Count} students</b></td></tr>
          </table>

          ${noDataNotice}
          ${totalSessions > 0 ? `
          <div class="section-title">PER STUDENT PER SESSION</div>
          <div class="table-scroll">
            <table class="grid">
              <thead>
                <tr>
                  <th class="td-left">Adm No.</th>
                  <th class="td-left">Name</th>
                  ${sessionHeaders}
                  <th>Sessions Attended</th>
                  <th>Attendance (%)</th>
                </tr>
              </thead>
              <tbody>
                ${studentDataRows || '<tr><td colspan="100" style="text-align:center;color:#9ca3af;">No students enrolled</td></tr>'}
              </tbody>
            </table>
          </div>` : ''}
        </div>
        <div class="page-break"></div>
      `;
    }

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; padding: 16px 18px; }
  h1 { font-size: 16px; font-weight: 800; text-align: center; color: #312e81; margin-bottom: 12px; letter-spacing: 0.5px; }
  .unit-block { margin-bottom: 20px; }
  .page-break { page-break-after: always; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .meta-table td { padding: 4px 8px; font-size: 11px; }
  .meta-table td:first-child { width: 120px; color: #374151; }
  .section-title { font-size: 12px; font-weight: bold; background-color: #4f46e5; color: #fff; padding: 5px 10px; margin: 12px 0 8px; border-radius: 3px; }
  .summary-table { width: 50%; border-collapse: collapse; margin-bottom: 12px; }
  .summary-table td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  .summary-table td:first-child { width: 65%; color: #374151; }
  .table-scroll { overflow-x: auto; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.grid th { background-color: #4f46e5; color: #fff; padding: 5px 3px; text-align: center; border: 1px solid #3730a3; font-size: 9px; white-space: nowrap; }
  table.grid td { padding: 4px 3px; text-align: center; border: 1px solid #e5e7eb; }
  table.grid tr:nth-child(even) { background-color: #f9fafb; }
  .td-left { text-align: left !important; padding-left: 6px !important; }
  .present { color: #059669; font-weight: bold; font-size: 12px; }
  .absent { color: #dc2626; font-size: 12px; }
  .pct-low { color: #dc2626; font-weight: bold; }
  .pct-ok { color: #059669; font-weight: bold; }
</style>
</head>
<body>
${bodyHtml}
</body></html>`;

    const filename = `MarkWise_Attendance_${period}_${Date.now()}`;
    // react-native-html-to-pdf on Android may ignore the directory param on some versions.
    // We let it write wherever it wants, then copy to DocumentDirectoryPath ourselves.
    const file = await generatePDF({
      html,
      fileName: filename,
      directory: RNFS.DocumentDirectoryPath,
      base64: false,
      height: 842,
      width: 595,
    });
    if (!file?.filePath) {
      throw new Error('PDF conversion failed — the HTML-to-PDF library returned no output file. Check that react-native-html-to-pdf is correctly linked.');
    }
    // Normalise: strip scheme prefix, ensure absolute path
    const rawPath = String(file.filePath).trim().replace(/^(file:\/\/)+/, '');
    const srcPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    // Ensure the file actually exists at the returned path
    const srcExists = await RNFS.exists(srcPath);
    if (!srcExists) {
      throw new Error(`PDF was generated but the file was not found at: ${srcPath}`);
    }
    // If the library wrote outside DocumentDirectoryPath, copy it there for persistence
    const permanentPath = srcPath.startsWith(RNFS.DocumentDirectoryPath)
      ? srcPath
      : `${RNFS.DocumentDirectoryPath}/${filename}.pdf`;
    if (!srcPath.startsWith(RNFS.DocumentDirectoryPath)) {
      await RNFS.copyFile(srcPath, permanentPath);
    }
    return `file://${permanentPath}`;
  }, [fetchAttendanceGrid, normaliseGrid, processStudentRows]);

  // ── Unit Performance: fetch per-unit session breakdown from grid endpoint ──
  const fetchPerformanceData = useCallback(async (token, unitCodes, startDate, endDate) => {
    const results = {};
    await Promise.all(unitCodes.map(async (code) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/lecturer/units/${encodeURIComponent(code)}/attendance/grid?startDate=${startDate}&endDate=${endDate}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) { results[code] = null; return; }
        const data = await res.json();
        const { sessions, studentRows } = normaliseGrid(data);

        // Count by lesson type (from session object or lecture_room heuristic)
        const typeCounts = {};
        let onlineCount = 0;
        let offlineCount = 0;
        for (const s of sessions) {
          const raw = s.lessonType || s.lesson_type || s.type || s.slotType || s.lectureType || '';
          const sessIsOnline = String(s.lectureRoom || s.lecture_room || s.room || '').toUpperCase() === 'ONLINE'
            || String(raw).toUpperCase() === 'ONLINE';
          if (sessIsOnline) {
            onlineCount++;
          } else {
            offlineCount++;
          }
          // Normalise lesson type label
          const typeLabel = raw && raw.toUpperCase() !== 'ONLINE'
            ? (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase())
            : 'Lecture';
          typeCounts[typeLabel] = (typeCounts[typeLabel] || 0) + 1;
        }

        const totalSessions = sessions.length;
        const { processed } = processStudentRows(sessions, studentRows);
        const attended = processed.reduce((sum, r) => sum + r.attended, 0);
        const possible = totalSessions * (studentRows.length || 1);
        const avgAttendance = possible > 0 ? Math.round((attended / possible) * 100) : 0;

        results[code] = {
          totalSessions,
          onlineCount,
          offlineCount,
          typeCounts,       // { Lecture: 5, Tutorial: 2, … }
          avgAttendance,
          studentCount: studentRows.length,
        };
      } catch { results[code] = null; }
    }));
    return results;
  }, [normaliseGrid, processStudentRows]);

  // Generate Unit Performance PDF locally (backend fallback)
  const generatePerformancePDFLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const perfData = await fetchPerformanceData(token, unitCodes, startDate, endDate);
    const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    let bodyHtml = '';
    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;
      const perf = perfData[code];
      const ana = analyticsData[code] || {};

      const conductedSessions = perf?.totalSessions ?? safeNum(ana.conductedSessions ?? ana.conducted_sessions ?? ana.sessionCount);
      const onlineCount  = perf?.onlineCount  ?? 0;
      const offlineCount = perf?.offlineCount ?? conductedSessions;
      const studentCount = perf?.studentCount ?? safeNum(ana.students ?? ana.enrolledStudents);
      const avgAtt       = perf?.avgAttendance ?? safeNum(ana.attendanceRate ?? ana.attendance_rate);
      const typeCounts   = perf?.typeCounts   ?? {};

      // Planned sessions: estimate from timetable weeks in range
      const { startDate: sd, endDate: ed } = { startDate, endDate };
      const diffDays = Math.max(1, (new Date(ed) - new Date(sd)) / 86400000);
      const weeksInRange = Math.round(diffDays / 7);
      // Assumes 1 scheduled session/week per unit — backend should provide planned count ideally
      const plannedSessions = weeksInRange;
      const completionRate = plannedSessions > 0 ? Math.min(100, Math.round((conductedSessions / plannedSessions) * 100)) : null;

      // Lesson type breakdown rows
      const typeRows = Object.entries(
        Object.keys(typeCounts).length > 0 ? typeCounts : { Lecture: offlineCount, Online: onlineCount },
      ).map(([type, count]) =>
        `<tr><td>${esc(type)}</td><td>${count}</td><td>${conductedSessions > 0 ? Math.round((count / conductedSessions) * 100) : 0}%</td></tr>`
      ).join('');

      bodyHtml += `
        <div class="unit-block">
          <h1>UNIT PERFORMANCE REPORT</h1>
          <table class="meta-table">
            <tr><td><b>Department</b></td><td>${esc(department || 'General')}</td></tr>
            <tr><td><b>Unit</b></td><td>${esc(unitTitle)} (${esc(code)})</td></tr>
            <tr><td><b>Lecturer</b></td><td>${esc(lecturerName)}</td></tr>
            <tr><td><b>Period</b></td><td>${esc(PERIODS.find(p => p.key === period)?.label || period)}</td></tr>
            <tr><td><b>Generated</b></td><td>${generatedStr}</td></tr>
          </table>

          <div class="section-title">SESSION COMPLETION</div>
          <table class="summary-table">
            <tr><td>Sessions Conducted</td><td><b>${conductedSessions}</b></td></tr>
            <tr><td>Estimated Sessions Planned</td><td><b>${plannedSessions > 0 ? plannedSessions : 'N/A'}</b></td></tr>
            <tr><td>Completion Rate</td><td><b>${completionRate != null ? completionRate + '%' : 'N/A'}</b></td></tr>
            <tr><td>Online Sessions</td><td><b>${onlineCount}</b></td></tr>
            <tr><td>Offline / In-Person Sessions</td><td><b>${offlineCount}</b></td></tr>
            <tr><td>Average Class Attendance</td><td><b>${avgAtt > 0 ? avgAtt + '%' : 'N/A'}</b></td></tr>
            <tr><td>Students Enrolled</td><td><b>${studentCount}</b></td></tr>
          </table>

          <div class="section-title">LESSON TYPE BREAKDOWN</div>
          <table class="grid">
            <thead><tr><th class="td-left">Lesson Type</th><th>Sessions</th><th>% of Total</th></tr></thead>
            <tbody>${typeRows || '<tr><td colspan="3" style="text-align:center;color:#9ca3af;">No data available</td></tr>'}</tbody>
          </table>
        </div>
        <div class="page-break"></div>
      `;
    }

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  @page { margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; padding: 16px 18px; }
  h1 { font-size: 16px; font-weight: 800; text-align: center; color: #312e81; margin-bottom: 12px; letter-spacing: 0.5px; }
  .unit-block { margin-bottom: 20px; }
  .page-break { page-break-after: always; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .meta-table td { padding: 4px 8px; font-size: 11px; }
  .meta-table td:first-child { width: 130px; color: #374151; }
  .section-title { font-size: 12px; font-weight: bold; background-color: #4f46e5; color: #fff; padding: 5px 10px; margin: 12px 0 8px; border-radius: 3px; }
  .summary-table { width: 60%; border-collapse: collapse; margin-bottom: 12px; }
  .summary-table td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  .summary-table td:first-child { width: 70%; color: #374151; }
  table.grid { width: 60%; border-collapse: collapse; font-size: 10px; }
  table.grid th { background-color: #4f46e5; color: #fff; padding: 5px 8px; text-align: center; border: 1px solid #3730a3; }
  table.grid th.td-left, table.grid td.td-left { text-align: left; padding-left: 8px; }
  table.grid td { padding: 4px 8px; text-align: center; border: 1px solid #e5e7eb; }
  table.grid tr:nth-child(even) { background-color: #f9fafb; }
</style>
</head>
<body>${bodyHtml}</body></html>`;

    const filename = `MarkWise_Performance_${period}_${Date.now()}`;
    const file = await generatePDF({ html, fileName: filename, directory: RNFS.DocumentDirectoryPath, base64: false, height: 842, width: 595 });
    if (!file?.filePath) throw new Error('PDF conversion failed');
    const rawPath = String(file.filePath).trim().replace(/^(file:\/\/)+/, '');
    const srcPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const srcExists = await RNFS.exists(srcPath);
    if (!srcExists) throw new Error(`PDF was generated but the file was not found at: ${srcPath}`);
    const permanentPath = srcPath.startsWith(RNFS.DocumentDirectoryPath)
      ? srcPath
      : `${RNFS.DocumentDirectoryPath}/${filename}.pdf`;
    if (!srcPath.startsWith(RNFS.DocumentDirectoryPath)) {
      await RNFS.copyFile(srcPath, permanentPath);
    }
    return `file://${permanentPath}`;
  }, [fetchPerformanceData]);

  // Generate Unit Performance CSV locally (backend fallback)
  const generatePerformanceCSVLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const escapeCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    const perfData = await fetchPerformanceData(token, unitCodes, startDate, endDate);
    const lines = [];

    lines.push(escapeCell('MARKWISE UNIT PERFORMANCE REPORT'));
    lines.push(escapeCell(`Department: ${department || 'General'}`));
    lines.push(escapeCell(`Lecturer: ${lecturerName}`));
    lines.push(escapeCell(`Period: ${PERIODS.find(p => p.key === period)?.label || period}`));
    lines.push(escapeCell(`Generated: ${generatedStr}`));
    lines.push('');

    // Summary table header
    lines.push([
      escapeCell('Unit Code'), escapeCell('Unit Name'),
      escapeCell('Sessions Conducted'), escapeCell('Online Sessions'), escapeCell('Offline Sessions'),
      escapeCell('Completion Rate (%)'), escapeCell('Avg Attendance (%)'), escapeCell('Students Enrolled'),
    ].join(','));

    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;
      const perf = perfData[code];
      const ana = analyticsData[code] || {};

      const conductedSessions = perf?.totalSessions ?? safeNum(ana.conductedSessions ?? ana.conducted_sessions ?? ana.sessionCount);
      const onlineCount  = perf?.onlineCount  ?? 0;
      const offlineCount = perf?.offlineCount ?? conductedSessions;
      const studentCount = perf?.studentCount ?? safeNum(ana.students ?? ana.enrolledStudents);
      const avgAtt       = perf?.avgAttendance ?? safeNum(ana.attendanceRate ?? ana.attendance_rate);
      const diffDays     = Math.max(1, (new Date(endDate) - new Date(startDate)) / 86400000);
      const plannedSessions = Math.round(diffDays / 7);
      const completionRate = plannedSessions > 0 ? Math.min(100, Math.round((conductedSessions / plannedSessions) * 100)) : 'N/A';

      lines.push([
        escapeCell(code), escapeCell(unitTitle),
        escapeCell(conductedSessions), escapeCell(onlineCount), escapeCell(offlineCount),
        escapeCell(completionRate), escapeCell(avgAtt > 0 ? avgAtt : 'N/A'), escapeCell(studentCount),
      ].join(','));
    }

    lines.push('');
    lines.push(escapeCell('LESSON TYPE BREAKDOWN'));
    lines.push([escapeCell('Unit Code'), escapeCell('Lesson Type'), escapeCell('Sessions'), escapeCell('% of Unit Total')].join(','));
    for (const code of unitCodes) {
      const perf = perfData[code];
      const total = perf?.totalSessions || 0;
      const types = Object.keys(perf?.typeCounts || {}).length > 0
        ? perf.typeCounts
        : { Lecture: perf?.offlineCount || 0, Online: perf?.onlineCount || 0 };
      for (const [type, count] of Object.entries(types)) {
        lines.push([
          escapeCell(code), escapeCell(type), escapeCell(count),
          escapeCell(total > 0 ? Math.round((count / total) * 100) + '%' : 'N/A'),
        ].join(','));
      }
    }

    const csv = lines.join('\n');
    const filename = `MarkWise_Performance_${period}_${Date.now()}.csv`;
    const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
    await RNFS.writeFile(path, csv, 'utf8');
    return path;
  }, [fetchPerformanceData]);

  // ── Shared PDF write helper ───────────────────────────────────────────────
  const writePDF = useCallback(async (html, filenameStem) => {
    const file = await generatePDF({ html, fileName: filenameStem, directory: RNFS.DocumentDirectoryPath, base64: false, height: 842, width: 595 });
    if (!file?.filePath) throw new Error('PDF conversion failed');
    const rawPath = String(file.filePath).trim().replace(/^(file:\/\/)+/, '');
    const srcPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    if (!await RNFS.exists(srcPath)) throw new Error(`PDF not found at: ${srcPath}`);
    const permanentPath = srcPath.startsWith(RNFS.DocumentDirectoryPath)
      ? srcPath : `${RNFS.DocumentDirectoryPath}/${filenameStem}.pdf`;
    if (!srcPath.startsWith(RNFS.DocumentDirectoryPath)) await RNFS.copyFile(srcPath, permanentPath);
    return `file://${permanentPath}`;
  }, []);

  const PDF_STYLES = `
    @page{margin:14mm 12mm;}
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;padding:16px 18px;}
    h1{font-size:16px;font-weight:800;text-align:center;color:#312e81;margin-bottom:12px;letter-spacing:.5px;}
    .unit-block{margin-bottom:20px;}
    .page-break{page-break-after:always;}
    .meta-table{width:100%;border-collapse:collapse;margin-bottom:12px;}
    .meta-table td{padding:4px 8px;font-size:11px;}
    .meta-table td:first-child{width:130px;color:#374151;}
    .summary-table{width:55%;border-collapse:collapse;margin-bottom:12px;}
    .summary-table td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;}
    .summary-table td:first-child{width:70%;color:#374151;}
    table.grid{width:100%;border-collapse:collapse;font-size:10px;}
    table.grid th{padding:5px 6px;text-align:center;border:1px solid #ccc;font-size:9px;white-space:nowrap;}
    table.grid td{padding:4px 5px;text-align:center;border:1px solid #e5e7eb;}
    table.grid tr:nth-child(even){background-color:#f9fafb;}
    .td-left{text-align:left!important;padding-left:7px!important;}
    .pct-low{color:#dc2626;font-weight:bold;}
    .pct-ok{color:#059669;font-weight:bold;}
    .badge-risk{background:#fef2f2;color:#dc2626;padding:1px 5px;border-radius:10px;font-size:9px;font-weight:bold;}
    .badge-warn{background:#fffbeb;color:#d97706;padding:1px 5px;border-radius:10px;font-size:9px;font-weight:bold;}
    .badge-good{background:#f0fdf4;color:#059669;padding:1px 5px;border-radius:10px;font-size:9px;font-weight:bold;}
  `;

  const pdfSectionTitle = useCallback((label, color = '#4f46e5') =>
    `<div style="font-size:12px;font-weight:bold;background:${color};color:#fff;padding:5px 10px;margin:12px 0 8px;border-radius:3px;">${label}</div>`,
  []);

  const pdfMeta = useCallback((esc, department, unitTitle, code, lecturerName, period, generatedStr) => `
    <table class="meta-table">
      <tr><td><b>Department</b></td><td>${esc(department||'General')}</td></tr>
      <tr><td><b>Unit</b></td><td>${esc(unitTitle)} (${esc(code)})</td></tr>
      <tr><td><b>Lecturer</b></td><td>${esc(lecturerName)}</td></tr>
      <tr><td><b>Period</b></td><td>${esc(PERIODS.find(p=>p.key===period)?.label||period)}</td></tr>
      <tr><td><b>Generated</b></td><td>${generatedStr}</td></tr>
    </table>`,
  []);

  // ── Session Log ──────────────────────────────────────────────────────────
  const generateSessionsPDFLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const esc = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let bodyHtml = '';
    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;
      const gridData = await fetchAttendanceGrid(token, code, startDate, endDate);
      const { sessions, studentRows } = normaliseGrid(gridData);
      const totalStudents = studentRows.length;

      const sessionRows = sessions.map((sess, idx) => {
        const sessId = sess.sessionId ?? sess.id ?? sess.session_id ?? idx;
        let presentCount = 0;
        for (const sr of studentRows) {
          let present = false;
          if (sr.records && typeof sr.records === 'object') {
            const v = sr.records[sessId] ?? sr.records[String(sessId)];
            if (v !== undefined) present = !!v;
          } else {
            const arr = Array.isArray(sr.attendance) ? sr.attendance
              : Array.isArray(sr.sessions) ? sr.sessions
              : Array.isArray(sr.present) ? sr.present : null;
            if (arr) present = !!arr[idx];
          }
          if (present) presentCount++;
        }
        const pct = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;
        const rawDate = sess.date || sess.sessionDate || sess.slot_date || sess.startTime || '';
        const dateStr = rawDate ? (() => { try { return new Date(rawDate).toLocaleDateString('en-GB'); } catch { return rawDate; } })() : 'N/A';
        return {
          label: sess.label || sess.slot_label || sess.slotLabel || sess.title || `Session ${idx + 1}`,
          date: dateStr,
          room: sess.lectureRoom || sess.lecture_room || sess.room || 'N/A',
          type: sess.lessonType || sess.lesson_type || sess.type || 'Lecture',
          presentCount, pct,
        };
      });

      const tableRows = sessionRows.map((s, i) => `<tr>
        <td>${i+1}</td><td class="td-left">${esc(s.label)}</td><td>${esc(s.date)}</td>
        <td>${esc(s.room)}</td><td>${esc(s.type)}</td>
        <td>${s.presentCount} / ${totalStudents}</td>
        <td class="${s.pct<75?'pct-low':'pct-ok'}">${s.pct}%</td>
      </tr>`).join('');

      bodyHtml += `<div class="unit-block">
        <h1>SESSION LOG</h1>
        ${pdfMeta(esc, department, unitTitle, code, lecturerName, period, generatedStr)}
        ${pdfSectionTitle('SUMMARY','#0f766e')}
        <table class="summary-table">
          <tr><td>Sessions Conducted</td><td><b>${sessions.length}</b></td></tr>
          <tr><td>Students Enrolled</td><td><b>${totalStudents}</b></td></tr>
        </table>
        ${sessions.length > 0 ? `
        ${pdfSectionTitle('SESSION DETAILS','#0f766e')}
        <table class="grid">
          <thead><tr>
            <th>#</th><th class="td-left">Label</th><th>Date</th><th>Room</th><th>Type</th><th>Attendance</th><th>Rate</th>
          </tr></thead>
          <tbody>${tableRows||'<tr><td colspan="7" style="text-align:center;color:#9ca3af;">No sessions found</td></tr>'}</tbody>
        </table>` : '<p style="color:#6b7280;font-style:italic;">No sessions found for this period.</p>'}
      </div><div class="page-break"></div>`;
    }

    return writePDF(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PDF_STYLES}table.grid th{background-color:#0f766e;}</style></head><body>${bodyHtml}</body></html>`,
      `MarkWise_Sessions_${period}_${Date.now()}`);
  }, [fetchAttendanceGrid, normaliseGrid, writePDF, PDF_STYLES, pdfSectionTitle, pdfMeta]);

  const generateSessionsCSVLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const e = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
    const lines = [];
    lines.push(e('MARKWISE SESSION LOG'));
    lines.push(e(`Department: ${department||'General'}`));
    lines.push(e(`Lecturer: ${lecturerName}`));
    lines.push(e(`Period: ${PERIODS.find(p=>p.key===period)?.label||period}`));
    lines.push(e(`Generated: ${generatedStr}`));
    lines.push('');

    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      lines.push(e(`Unit: ${unitEntry?.unitName||code} (${code})`));
      lines.push([e('#'),e('Label'),e('Date'),e('Room'),e('Type'),e('Students Present'),e('Students Enrolled'),e('Attendance (%)')].join(','));

      const gridData = await fetchAttendanceGrid(token, code, startDate, endDate);
      const { sessions, studentRows } = normaliseGrid(gridData);
      const totalStudents = studentRows.length;

      if (sessions.length === 0) {
        lines.push(e('No sessions found for this period.'));
      } else {
        sessions.forEach((sess, idx) => {
          const sessId = sess.sessionId ?? sess.id ?? sess.session_id ?? idx;
          let presentCount = 0;
          for (const sr of studentRows) {
            let present = false;
            if (sr.records && typeof sr.records === 'object') {
              const v = sr.records[sessId] ?? sr.records[String(sessId)];
              if (v !== undefined) present = !!v;
            } else {
              const arr = Array.isArray(sr.attendance) ? sr.attendance
                : Array.isArray(sr.sessions) ? sr.sessions
                : Array.isArray(sr.present) ? sr.present : null;
              if (arr) present = !!arr[idx];
            }
            if (present) presentCount++;
          }
          const pct = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;
          const rawDate = sess.date || sess.sessionDate || sess.slot_date || '';
          const dateStr = rawDate ? (() => { try { return new Date(rawDate).toLocaleDateString('en-GB'); } catch { return rawDate; } })() : 'N/A';
          lines.push([
            e(idx+1), e(sess.label||sess.slot_label||`Session ${idx+1}`), e(dateStr),
            e(sess.lectureRoom||sess.room||'N/A'), e(sess.lessonType||sess.type||'Lecture'),
            e(presentCount), e(totalStudents), e(`${pct}%`),
          ].join(','));
        });
      }
      lines.push('');
    }

    const filename = `MarkWise_Sessions_${period}_${Date.now()}.csv`;
    const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
    await RNFS.writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }, [fetchAttendanceGrid, normaliseGrid]);

  // ── Student Progress ─────────────────────────────────────────────────────
  const generateStudentsPDFLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const esc = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let bodyHtml = '';
    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;
      const gridData = await fetchAttendanceGrid(token, code, startDate, endDate);
      const { sessions, studentRows } = normaliseGrid(gridData);
      const { processed, below75Count } = processStudentRows(sessions, studentRows);
      const totalSessions = sessions.length;
      const half = Math.floor(totalSessions / 2);

      const studentTableRows = processed.map(r => {
        const trend = totalSessions >= 4
          ? (() => {
              const first = r.sessionPresence.slice(0, half).filter(Boolean).length;
              const second = r.sessionPresence.slice(half).filter(Boolean).length;
              const firstPct = half > 0 ? Math.round((first / half) * 100) : 0;
              const secondPct = (totalSessions - half) > 0 ? Math.round((second / (totalSessions - half)) * 100) : 0;
              const diff = secondPct - firstPct;
              if (diff >= 10) return '&#9650; Improving';
              if (diff <= -10) return '&#9660; Declining';
              return '&#8212; Stable';
            })()
          : '&#8212; N/A';
        const badge = r.pct < 75
          ? `<span class="badge-risk">At Risk</span>`
          : r.pct < 80
            ? `<span class="badge-warn">Warning</span>`
            : `<span class="badge-good">Good</span>`;
        return `<tr>
          <td class="td-left">${esc(r.admNo)}</td>
          <td class="td-left">${esc(r.name)}</td>
          <td>${r.attended} / ${totalSessions}</td>
          <td class="${r.pct<75?'pct-low':r.pct<80?'':'pct-ok'}">${r.pct}%</td>
          <td>${trend}</td>
          <td>${badge}</td>
        </tr>`;
      }).join('');

      bodyHtml += `<div class="unit-block">
        <h1>STUDENT PROGRESS REPORT</h1>
        ${pdfMeta(esc, department, unitTitle, code, lecturerName, period, generatedStr)}
        ${pdfSectionTitle('SUMMARY','#0369a1')}
        <table class="summary-table">
          <tr><td>Students Enrolled</td><td><b>${processed.length}</b></td></tr>
          <tr><td>Sessions Conducted</td><td><b>${totalSessions}</b></td></tr>
          <tr><td>At Risk (Below 75%)</td><td><b style="color:#dc2626">${below75Count}</b></td></tr>
          <tr><td>On Track (75% and above)</td><td><b style="color:#059669">${processed.length - below75Count}</b></td></tr>
        </table>
        ${pdfSectionTitle('PER-STUDENT PROGRESS','#0369a1')}
        <table class="grid">
          <thead><tr>
            <th class="td-left">Adm No.</th><th class="td-left">Name</th>
            <th>Attendance</th><th>Rate</th><th>Trend</th><th>Status</th>
          </tr></thead>
          <tbody>${studentTableRows||'<tr><td colspan="6" style="text-align:center;color:#9ca3af;">No students enrolled</td></tr>'}</tbody>
        </table>
      </div><div class="page-break"></div>`;
    }

    return writePDF(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PDF_STYLES}table.grid th{background-color:#0369a1;}</style></head><body>${bodyHtml}</body></html>`,
      `MarkWise_Students_${period}_${Date.now()}`);
  }, [fetchAttendanceGrid, normaliseGrid, processStudentRows, writePDF, PDF_STYLES, pdfSectionTitle, pdfMeta]);

  const generateStudentsCSVLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const e = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
    const lines = [];
    lines.push(e('MARKWISE STUDENT PROGRESS REPORT'));
    lines.push(e(`Department: ${department||'General'}`));
    lines.push(e(`Lecturer: ${lecturerName}`));
    lines.push(e(`Period: ${PERIODS.find(p=>p.key===period)?.label||period}`));
    lines.push(e(`Generated: ${generatedStr}`));
    lines.push('');

    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      lines.push(e(`Unit: ${unitEntry?.unitName||code} (${code})`));
      lines.push([e('Adm No.'),e('Name'),e('Sessions Attended'),e('Total Sessions'),e('Attendance (%)'),e('Trend'),e('Status')].join(','));

      const gridData = await fetchAttendanceGrid(token, code, startDate, endDate);
      const { sessions, studentRows } = normaliseGrid(gridData);
      const { processed } = processStudentRows(sessions, studentRows);
      const totalSessions = sessions.length;
      const half = Math.floor(totalSessions / 2);

      for (const r of processed) {
        const trend = totalSessions >= 4
          ? (() => {
              const first = r.sessionPresence.slice(0, half).filter(Boolean).length;
              const second = r.sessionPresence.slice(half).filter(Boolean).length;
              const firstPct = half > 0 ? Math.round((first / half) * 100) : 0;
              const secondPct = (totalSessions - half) > 0 ? Math.round((second / (totalSessions - half)) * 100) : 0;
              const diff = secondPct - firstPct;
              if (diff >= 10) return 'Improving';
              if (diff <= -10) return 'Declining';
              return 'Stable';
            })()
          : 'N/A';
        const status = r.pct < 75 ? 'At Risk' : r.pct < 80 ? 'Warning' : 'Good';
        lines.push([e(r.admNo),e(r.name),e(r.attended),e(totalSessions),e(`${r.pct}%`),e(trend),e(status)].join(','));
      }
      lines.push('');
    }

    const filename = `MarkWise_Students_${period}_${Date.now()}.csv`;
    const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
    await RNFS.writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }, [fetchAttendanceGrid, normaliseGrid, processStudentRows]);

  // ── Assignment Summary ────────────────────────────────────────────────────
  const fetchAssignmentsData = useCallback(async (token, code, startDate, endDate) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/lecturer/units/${encodeURIComponent(code)}/assignments?startDate=${startDate}&endDate=${endDate}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, []);

  const generateAssignmentsPDFLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const esc = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let bodyHtml = '';
    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;
      const assignData = await fetchAssignmentsData(token, code, startDate, endDate);

      const assignments = Array.isArray(assignData?.assignments) ? assignData.assignments
        : Array.isArray(assignData) ? assignData : [];
      const ana = analyticsData[code] || {};
      const totalCount = assignments.length || (ana.assignments ?? ana.assignmentCount ?? 0);

      const tableRows = assignments.map((a, i) => {
        const total = Number(a.totalStudents || a.enrolled || 0);
        const submitted = Number(a.submitted || a.submissions || a.totalSubmissions || 0);
        const late = Number(a.lateSubmissions || a.late || 0);
        const subRate = total > 0 ? Math.round((submitted / total) * 100) : 0;
        const avgGrade = a.averageGrade != null ? `${Math.round(Number(a.averageGrade))}%` : 'N/A';
        const dueDate = a.dueDate || a.due_date || '';
        const dueDateStr = dueDate ? (() => { try { return new Date(dueDate).toLocaleDateString('en-GB'); } catch { return dueDate; } })() : 'N/A';
        return `<tr>
          <td>${i+1}</td><td class="td-left">${esc(a.title||a.name||`Assignment ${i+1}`)}</td>
          <td>${dueDateStr}</td><td>${submitted} / ${total}</td>
          <td class="${subRate<75?'pct-low':'pct-ok'}">${subRate}%</td>
          <td>${late}</td><td>${avgGrade}</td>
        </tr>`;
      }).join('');

      const noEndpoint = assignments.length === 0;
      bodyHtml += `<div class="unit-block">
        <h1>ASSIGNMENT SUMMARY</h1>
        ${pdfMeta(esc, department, unitTitle, code, lecturerName, period, generatedStr)}
        ${pdfSectionTitle('SUMMARY','#b45309')}
        <table class="summary-table">
          <tr><td>Total Assignments</td><td><b>${totalCount}</b></td></tr>
        </table>
        ${noEndpoint
          ? `<p style="color:#6b7280;font-style:italic;padding:8px 0;">Detailed assignment data requires the backend endpoint<br><code>GET /api/lecturer/units/{code}/assignments</code>.<br>Total assignment count sourced from analytics.</p>`
          : `${pdfSectionTitle('ASSIGNMENT DETAILS','#b45309')}
          <table class="grid">
            <thead><tr>
              <th>#</th><th class="td-left">Title</th><th>Due Date</th><th>Submissions</th><th>Sub. Rate</th><th>Late</th><th>Avg Grade</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>`}
      </div><div class="page-break"></div>`;
    }

    return writePDF(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PDF_STYLES}table.grid th{background-color:#b45309;}</style></head><body>${bodyHtml}</body></html>`,
      `MarkWise_Assignments_${period}_${Date.now()}`);
  }, [fetchAssignmentsData, writePDF, PDF_STYLES, pdfSectionTitle, pdfMeta]);

  const generateAssignmentsCSVLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const e = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
    const lines = [];
    lines.push(e('MARKWISE ASSIGNMENT SUMMARY'));
    lines.push(e(`Department: ${department||'General'}`));
    lines.push(e(`Lecturer: ${lecturerName}`));
    lines.push(e(`Period: ${PERIODS.find(p=>p.key===period)?.label||period}`));
    lines.push(e(`Generated: ${generatedStr}`));
    lines.push('');

    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      lines.push(e(`Unit: ${unitEntry?.unitName||code} (${code})`));
      const assignData = await fetchAssignmentsData(token, code, startDate, endDate);
      const assignments = Array.isArray(assignData?.assignments) ? assignData.assignments
        : Array.isArray(assignData) ? assignData : [];

      if (assignments.length === 0) {
        const ana = analyticsData[code] || {};
        lines.push(e(`Total Assignments: ${ana.assignments ?? ana.assignmentCount ?? 'N/A'}`));
        lines.push(e('Detailed data requires GET /api/lecturer/units/{code}/assignments endpoint.'));
      } else {
        lines.push([e('Title'),e('Due Date'),e('Submitted'),e('Total Students'),e('Sub. Rate (%)'),e('Late Submissions'),e('Avg Grade')].join(','));
        for (const a of assignments) {
          const total = Number(a.totalStudents || a.enrolled || 0);
          const submitted = Number(a.submitted || a.submissions || a.totalSubmissions || 0);
          const late = Number(a.lateSubmissions || a.late || 0);
          const subRate = total > 0 ? Math.round((submitted / total) * 100) : 0;
          const dueDate = a.dueDate || a.due_date || '';
          const dueDateStr = dueDate ? (() => { try { return new Date(dueDate).toLocaleDateString('en-GB'); } catch { return dueDate; } })() : 'N/A';
          lines.push([
            e(a.title||a.name||'Untitled'), e(dueDateStr), e(submitted), e(total),
            e(`${subRate}%`), e(late), e(a.averageGrade!=null?`${Math.round(Number(a.averageGrade))}%`:'N/A'),
          ].join(','));
        }
      }
      lines.push('');
    }

    const filename = `MarkWise_Assignments_${period}_${Date.now()}.csv`;
    const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
    await RNFS.writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }, [fetchAssignmentsData]);

  // ── Comprehensive Report ─────────────────────────────────────────────────
  const generateComprehensivePDFLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData, requestedTypes) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const esc = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const safeNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const types = requestedTypes && requestedTypes.length > 0 ? requestedTypes
      : ['attendance','performance','sessions','students','assignments'];

    const [perfData, allGrids, allAssignments] = await Promise.all([
      types.includes('performance') || types.includes('comprehensive')
        ? fetchPerformanceData(token, unitCodes, startDate, endDate) : Promise.resolve({}),
      (types.includes('attendance') || types.includes('sessions') || types.includes('students') || types.includes('comprehensive'))
        ? Promise.all(unitCodes.map(async code => {
            const g = await fetchAttendanceGrid(token, code, startDate, endDate);
            return { code, ...normaliseGrid(g) };
          }))
        : Promise.resolve([]),
      (types.includes('assignments') || types.includes('comprehensive'))
        ? Promise.all(unitCodes.map(async code => ({ code, data: await fetchAssignmentsData(token, code, startDate, endDate) })))
        : Promise.resolve([]),
    ]);

    const gridMap = {};
    for (const g of allGrids) gridMap[g.code] = g;
    const assignMap = {};
    for (const a of allAssignments) assignMap[a.code] = a.data;

    let bodyHtml = `<div style="text-align:center;margin-bottom:24px;">
      <h1 style="font-size:20px;color:#312e81;">COMPREHENSIVE REPORT</h1>
      <p style="color:#6b7280;font-size:11px;">Department: ${esc(department||'General')} &nbsp;|&nbsp; Lecturer: ${esc(lecturerName)} &nbsp;|&nbsp; ${esc(PERIODS.find(p=>p.key===period)?.label||period)} &nbsp;|&nbsp; Generated: ${generatedStr}</p>
    </div>`;

    for (const code of unitCodes) {
      const unitEntry = currentUnits.find(u => u.unitCode === code);
      const unitTitle = unitEntry?.unitName || unitEntry?.name || code;
      const grid = gridMap[code] || { sessions: [], studentRows: [] };
      const { sessions, studentRows } = grid;
      const { processed, below75Count } = processStudentRows(sessions, studentRows);
      const totalSessions = sessions.length;
      const totalStudents = studentRows.length;
      const overallPresent = processed.reduce((s, r) => s + r.attended, 0);
      const avgAtt = totalStudents > 0 && totalSessions > 0
        ? Math.round((overallPresent / (totalStudents * totalSessions)) * 100) : 0;

      const perf = perfData[code];
      const ana = analyticsData[code] || {};
      const conductedSessions = perf?.totalSessions ?? safeNum(ana.conductedSessions ?? ana.conducted_sessions);
      const onlineCount = perf?.onlineCount ?? 0;

      bodyHtml += `<div class="unit-block">
        <div style="background:#312e81;color:#fff;padding:8px 12px;border-radius:4px;margin-bottom:12px;">
          <b style="font-size:13px;">${esc(unitTitle)}</b> &nbsp;<span style="opacity:0.8;font-size:11px;">${esc(code)}</span>
        </div>`;

      // Overview table
      bodyHtml += `${pdfSectionTitle('OVERVIEW','#4f46e5')}
        <table class="summary-table">
          <tr><td>Students Enrolled</td><td><b>${totalStudents}</b></td></tr>
          <tr><td>Sessions Conducted</td><td><b>${conductedSessions||totalSessions}</b></td></tr>
          <tr><td>Online Sessions</td><td><b>${onlineCount}</b></td></tr>
          <tr><td>Average Attendance</td><td><b>${avgAtt > 0 ? avgAtt+'%' : 'N/A'}</b></td></tr>
          <tr><td>At-Risk Students (below 75%)</td><td><b style="color:#dc2626">${below75Count}</b></td></tr>
        </table>`;

      // Attendance grid (condensed — just top 10 at-risk students)
      if (types.includes('attendance') || types.includes('comprehensive')) {
        const atRisk = processed.filter(r => r.pct < 75).slice(0, 10);
        if (atRisk.length > 0) {
          bodyHtml += `${pdfSectionTitle('AT-RISK STUDENTS (BELOW 75%)','#dc2626')}
            <table class="grid">
              <thead><tr><th class="td-left">Adm No.</th><th class="td-left">Name</th><th>Sessions Attended</th><th>Rate</th></tr></thead>
              <tbody>${atRisk.map(r => `<tr>
                <td class="td-left">${esc(r.admNo)}</td><td class="td-left">${esc(r.name)}</td>
                <td>${r.attended} / ${totalSessions}</td><td class="pct-low">${r.pct}%</td>
              </tr>`).join('')}</tbody>
            </table>`;
          if (processed.filter(r => r.pct < 75).length > 10) {
            bodyHtml += `<p style="color:#6b7280;font-size:9px;margin-top:4px;">Showing first 10 at-risk students. Generate Attendance Report for full list.</p>`;
          }
        }
      }

      // Session log (condensed)
      if ((types.includes('sessions') || types.includes('comprehensive')) && sessions.length > 0) {
        const sessionRows = sessions.slice(0, 8).map((sess, idx) => {
          const sessId = sess.sessionId ?? sess.id ?? sess.session_id ?? idx;
          let presentCount = 0;
          for (const sr of studentRows) {
            let present = false;
            if (sr.records && typeof sr.records === 'object') {
              const v = sr.records[sessId] ?? sr.records[String(sessId)];
              if (v !== undefined) present = !!v;
            } else {
              const arr = Array.isArray(sr.attendance) ? sr.attendance : Array.isArray(sr.sessions) ? sr.sessions : Array.isArray(sr.present) ? sr.present : null;
              if (arr) present = !!arr[idx];
            }
            if (present) presentCount++;
          }
          const pct = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;
          return `<tr>
            <td>${idx+1}</td><td class="td-left">${esc(sess.label||sess.title||`Session ${idx+1}`)}</td>
            <td>${esc(sess.lectureRoom||sess.room||'N/A')}</td>
            <td>${presentCount}/${totalStudents}</td>
            <td class="${pct<75?'pct-low':'pct-ok'}">${pct}%</td>
          </tr>`;
        }).join('');
        bodyHtml += `${pdfSectionTitle('RECENT SESSIONS','#0f766e')}
          <table class="grid">
            <thead><tr><th>#</th><th class="td-left">Label</th><th>Room</th><th>Attendance</th><th>Rate</th></tr></thead>
            <tbody>${sessionRows}</tbody>
          </table>
          ${sessions.length > 8 ? '<p style="color:#6b7280;font-size:9px;margin-top:4px;">Showing 8 most recent sessions.</p>' : ''}`;
      }

      // Assignments (condensed)
      if (types.includes('assignments') || types.includes('comprehensive')) {
        const assignData = assignMap[code];
        const assignments = Array.isArray(assignData?.assignments) ? assignData.assignments
          : Array.isArray(assignData) ? assignData : [];
        if (assignments.length > 0) {
          const assignRows = assignments.slice(0, 5).map((a, i) => {
            const total = Number(a.totalStudents || a.enrolled || 0);
            const submitted = Number(a.submitted || a.submissions || a.totalSubmissions || 0);
            const subRate = total > 0 ? Math.round((submitted / total) * 100) : 0;
            return `<tr>
              <td class="td-left">${esc(a.title||a.name||`Assignment ${i+1}`)}</td>
              <td>${submitted}/${total}</td>
              <td class="${subRate<75?'pct-low':'pct-ok'}">${subRate}%</td>
              <td>${a.averageGrade!=null?`${Math.round(Number(a.averageGrade))}%`:'N/A'}</td>
            </tr>`;
          }).join('');
          bodyHtml += `${pdfSectionTitle('ASSIGNMENTS','#b45309')}
            <table class="grid">
              <thead><tr><th class="td-left">Title</th><th>Submissions</th><th>Sub. Rate</th><th>Avg Grade</th></tr></thead>
              <tbody>${assignRows}</tbody>
            </table>`;
        }
      }

      bodyHtml += `</div><div class="page-break"></div>`;
    }

    return writePDF(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PDF_STYLES}</style></head><body>${bodyHtml}</body></html>`,
      `MarkWise_Comprehensive_${period}_${Date.now()}`);
  }, [fetchPerformanceData, fetchAttendanceGrid, normaliseGrid, processStudentRows, fetchAssignmentsData, writePDF, PDF_STYLES, pdfSectionTitle]);

  const generateComprehensiveCSVLocal = useCallback(async (token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData, requestedTypes) => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const generatedStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const e = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
    const lines = [];
    lines.push(e('MARKWISE COMPREHENSIVE REPORT'));
    lines.push(e(`Department: ${department||'General'}`));
    lines.push(e(`Lecturer: ${lecturerName}`));
    lines.push(e(`Period: ${PERIODS.find(p=>p.key===period)?.label||period}`));
    lines.push(e(`Generated: ${generatedStr}`));
    lines.push('');
    lines.push(e('=== ATTENDANCE OVERVIEW ==='));
    const attendancePath = await generateAttendanceCSV(token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName);
    const attendanceContent = await RNFS.readFile(attendancePath, 'utf8').catch(() => '');
    lines.push(attendanceContent);
    lines.push('');
    lines.push(e('=== SESSION LOG ==='));
    const sessionsPath = await generateSessionsCSVLocal(token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName);
    const sessionsContent = await RNFS.readFile(sessionsPath, 'utf8').catch(() => '');
    lines.push(sessionsContent);
    lines.push('');
    lines.push(e('=== STUDENT PROGRESS ==='));
    const studentsPath = await generateStudentsCSVLocal(token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName);
    const studentsContent = await RNFS.readFile(studentsPath, 'utf8').catch(() => '');
    lines.push(studentsContent);
    lines.push('');
    lines.push(e('=== UNIT PERFORMANCE ==='));
    const performancePath = await generatePerformanceCSVLocal(token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData);
    const performanceContent = await RNFS.readFile(performancePath, 'utf8').catch(() => '');
    lines.push(performanceContent);
    lines.push('');
    lines.push(e('=== ASSIGNMENTS ==='));
    const assignmentsPath = await generateAssignmentsCSVLocal(token, unitCodes, period, startDate, endDate, currentUnits, department, lecturerName, analyticsData);
    const assignmentsContent = await RNFS.readFile(assignmentsPath, 'utf8').catch(() => '');
    lines.push(assignmentsContent);

    const filename = `MarkWise_Comprehensive_${period}_${Date.now()}.csv`;
    const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
    await RNFS.writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }, [generateAttendanceCSV, generateSessionsCSVLocal, generateStudentsCSVLocal, generatePerformanceCSVLocal, generateAssignmentsCSVLocal]);

  // Get date range for report
  const getDateRange = useCallback((period) => {
    const now = new Date();
    const endDate = now.toISOString().slice(0, 10);
    let startDate;
    
    switch (period) {
      case 'weekly':
        // Start of current week (Monday)
        const day = now.getDay();
        const diff = (day === 0 ? 6 : day - 1);
        const monday = new Date(now);
        monday.setDate(now.getDate() - diff);
        startDate = monday.toISOString().slice(0, 10);
        break;
      case 'monthly':
        // Start of current month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        break;
      case 'semester':
        // Use stored semester days or default
        startDate = new Date(now.getTime() - semesterDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
    return { startDate, endDate };
  }, [semesterDays]);

  // Generate report
  const handleGenerate = async () => {
    if (!isOnline) {
      Alert.alert('No Connection', 'An internet connection is required to generate reports.');
      return;
    }
    
    if (reportUnitCodes.length === 0) {
      Alert.alert('No Units Found', 'No units found for the selected department. Please sync your timetable first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sync Now', onPress: () => {
          // Trigger sync - navigate to timetable or refresh
        } }
      ]);
      return;
    }

    setGenerating(true);
    setGenerationProgress(0);
    generationAbortRef.current = new AbortController();

    try {
      const session = await getLecturerSession();
      if (!session?.token) throw new Error('Session expired. Please sign in again.');

      const period = selectedPeriod;
      const types = Array.from(selectedTypes);
      const format = selectedFormat;
      const department = selectedDepartment || 'General';
      const unitCodes = reportUnitCodes;
      const { startDate, endDate } = getDateRange(period);

      setGenerationProgress(20);

      // Fetch fresh analytics data once
      setGenerationProgress(40);
      const analyticsRes = await fetch(`${API_BASE_URL}/api/lecturer/analytics/batch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitCodes }),
        signal: generationAbortRef.current.signal,
      });
      
      const analyticsData = analyticsRes.ok ? await analyticsRes.json() : {};
      setGenerationProgress(60);

      let fileUrl = null;
      let reportFormat = format;
      let backendSucceeded = false;

      // Try backend generation
      try {
        const res = await fetch(`${API_BASE_URL}/api/reports/generate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ period, types, format, unitCodes, department, startDate, endDate }),
          signal: generationAbortRef.current.signal,
        });
        
        setGenerationProgress(80);
        
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message || `Server error (${res.status})`);
        }
        
        const result = await res.json();
        fileUrl = result?.fileUrl || result?.url || result?.downloadUrl || null;
        backendSucceeded = true;
      } catch (backendErr) {
        if (backendErr.name === 'AbortError') throw backendErr;
        
        // Fallback to local generation
        const lecturerName = session.name || session.lecturerName || session.fullName || session.lecturer_name || '';
        // Resolve primary type: use comprehensive generator for multi-type selections
        const primaryType = types.length === 1 ? types[0] : 'comprehensive';
        const typeLabels = {
          attendance: 'Attendance', performance: 'Performance', sessions: 'Sessions',
          students: 'Students', assignments: 'Assignments', comprehensive: 'Comprehensive',
        };
        const typeLabel = typeLabels[primaryType] || 'Report';
        const args = [session.token, unitCodes, period, startDate, endDate, units, department, lecturerName];

        if (format === 'pdf') {
          try {
            let localPath;
            switch (primaryType) {
              case 'attendance':
                localPath = await generateAttendancePDFLocal(...args); break;
              case 'performance':
                localPath = await generatePerformancePDFLocal(...args, analyticsData); break;
              case 'sessions':
                localPath = await generateSessionsPDFLocal(...args); break;
              case 'students':
                localPath = await generateStudentsPDFLocal(...args); break;
              case 'assignments':
                localPath = await generateAssignmentsPDFLocal(...args, analyticsData); break;
              default:
                localPath = await generateComprehensivePDFLocal(...args, analyticsData, types); break;
            }
            fileUrl = toSafeFileUri(localPath);
            reportFormat = 'pdf';
            backendSucceeded = false;
            await copyToShareCache(fileUrl)
              .then(cacheUri => Share.open({
                url: cacheUri,
                type: 'application/pdf',
                filename: `MarkWise_${typeLabel}_${period}.pdf`,
                failOnCancel: false,
              }))
              .catch(e => { if (!String(e?.message).toLowerCase().includes('cancel')) Alert.alert('Could not auto-share', e?.message || 'Share failed. You can still share from the recent reports list.'); });
          } catch (localErr) {
            throw new Error(`PDF generation failed: ${localErr?.message || String(localErr)}`);
          }
        } else if (format === 'csv' || format === 'excel') {
          try {
            let localPath;
            switch (primaryType) {
              case 'attendance':
                localPath = await generateAttendanceCSV(...args); break;
              case 'performance':
                localPath = await generatePerformanceCSVLocal(...args, analyticsData); break;
              case 'sessions':
                localPath = await generateSessionsCSVLocal(...args); break;
              case 'students':
                localPath = await generateStudentsCSVLocal(...args); break;
              case 'assignments':
                localPath = await generateAssignmentsCSVLocal(...args, analyticsData); break;
              default:
                localPath = await generateComprehensiveCSVLocal(...args, analyticsData, types); break;
            }
            fileUrl = toSafeFileUri(localPath);
            reportFormat = 'csv';
            backendSucceeded = false;
            await copyToShareCache(fileUrl)
              .then(cacheUri => Share.open({
                url: cacheUri,
                type: 'text/csv',
                filename: `MarkWise_${typeLabel}_${period}.csv`,
                failOnCancel: false,
              }))
              .catch(e => { if (!String(e?.message).toLowerCase().includes('cancel')) Alert.alert('Could not auto-share', e?.message || 'Share failed. You can still share from the recent reports list.'); });
          } catch (localErr) {
            throw new Error(`Report generation failed: ${localErr?.message || String(localErr)}`);
          }
        } else {
          throw backendErr;
        }
      }

      setGenerationProgress(100);

      const record = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        period,
        types,
        format: reportFormat,
        fileUrl,
        department,
        generatedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      };
      
      await saveReport(record);

      Alert.alert(
        'Report Generated ✓',
        backendSucceeded && fileUrl
          ? `Your ${PERIODS.find(p => p.key === period)?.label} report is ready. Tap the eye icon to open it.`
          : backendSucceeded
          ? `Your ${PERIODS.find(p => p.key === period)?.label} report has been generated.`
          : `${reportFormat.toUpperCase()} report generated and saved to your device.`,
        [{ text: 'OK' }]
      );
    } catch (err) {
      if (err.name === 'AbortError') {
        // Generation was cancelled
        return;
      }
      Alert.alert('Generation Failed', err?.message || 'Could not generate report. Please try again.');
    } finally {
      setGenerating(false);
      setGenerationProgress(0);
      generationAbortRef.current = null;
    }
  };

  const periodLabel = PERIODS.find(p => p.key === selectedPeriod)?.label || '';
  const selectedUnitLabel = selectedUnit === 'all'
    ? `All Units (${deptUnits.length})`
    : (deptUnits.find(u => u.unitCode === selectedUnit)?.unitCode || selectedUnit);

  return (
    <View style={styles.container}>
      <OfflineBanner />

      {/* Generation Progress Modal */}
      <ProgressModal visible={generating} progress={generationProgress} message="Generating your report..." />

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          (isTablet || isDesktop) && { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        showsVerticalScrollIndicator={false}
        opacity={fadeAnim}
      >
        {/* Hero Banner */}
        <LinearGradient colors={['#312E81', '#4F46E5', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroBanner}>
          <View style={styles.heroLeft}>            
            <Text style={styles.heroSubtitle}>Generate and export academic reports for any period.</Text>
          </View>
          <View style={styles.heroIconWrap}>
            <Icon name="file-chart-outline" size={42} color="rgba(255,255,255,0.25)" />
          </View>
        </LinearGradient>

        {/* Step 1: Department & Unit */}
        {units.length > 0 && (
          <View style={[styles.section, { marginTop: SPACING.xl }]}>
            <View style={styles.sectionHeader}>
              <View style={styles.stepBadge} accessibilityLabel="Step 1">
                <Text style={styles.stepBadgeText}>1</Text>
              </View>
              <Text style={styles.sectionTitle}>Department &amp; Unit</Text>
              <Text style={styles.sectionHint}>Choose scope</Text>
            </View>

            {/* Department pills — always show when multiple depts exist */}
            {departments.length > 1 && (
              <>
                <Text style={styles.deptSectionLabel}>Department</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deptScroll}>
                  {departments.map(d => {
                    const active = selectedDepartment === d.name;
                    return (
                      <TouchableOpacity
                        key={d.name}
                        style={[styles.deptPill, active && styles.deptPillActive]}
                        onPress={() => { setSelectedDepartment(d.name); setSelectedUnit('all'); }}
                        activeOpacity={0.75}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                      >
                        <Icon name="school-outline" size={13} color={active ? '#fff' : COLORS.textSecondary} />
                        <Text style={[styles.deptPillText, active && styles.deptPillTextActive]} numberOfLines={1}>{d.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {selectedDepartment && (
                  <Text style={styles.deptSelectedNote}>
                    <Icon name="information-outline" size={11} color={COLORS.textMuted} />{' '}
                    Report will cover units in <Text style={{ color: COLORS.primaryLight }}>{selectedDepartment}</Text> only.
                  </Text>
                )}
              </>
            )}

            {/* Unit pills — always show */}
            <Text style={[styles.deptSectionLabel, departments.length > 1 && { marginTop: SPACING.md }]}>Unit</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deptScroll}>
              <TouchableOpacity
                style={[styles.deptPill, styles.unitFilterPill, selectedUnit === 'all' && styles.deptPillActive]}
                onPress={() => setSelectedUnit('all')}
                activeOpacity={0.75}
              >
                <Icon name="view-grid-outline" size={12} color={selectedUnit === 'all' ? '#fff' : COLORS.textSecondary} />
                <Text style={[styles.deptPillText, selectedUnit === 'all' && styles.deptPillTextActive]}>All Units</Text>
              </TouchableOpacity>
              {deptUnits.map(u => {
                const active = selectedUnit === u.unitCode;
                return (
                  <TouchableOpacity
                    key={u.unitCode}
                    style={[styles.deptPill, styles.unitFilterPill, active && styles.deptPillActive]}
                    onPress={() => setSelectedUnit(u.unitCode)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.deptPillText, active && styles.deptPillTextActive]} numberOfLines={1}>
                      {u.unitCode}
                    </Text>
                    {active && (
                      <Text style={styles.deptPillUnitName} numberOfLines={1}>
                        {' '}· {deptUnits.find(x => x.unitCode === u.unitCode)?.unitName || ''}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Summary Stats */}
        <View style={styles.summaryRow}>
          <SummaryStat icon="book-open-variant" value={summaryStats.units} label="Units" color={COLORS.primary} loading={statsLoading} />
          <SummaryStat icon="account-group" value={summaryStats.students.toLocaleString()} label="Enrollments" color={COLORS.success} loading={statsLoading} />
          <SummaryStat icon="calendar-clock" value={summaryStats.sessions} label="Sessions" color={COLORS.info} loading={statsLoading} />
          <SummaryStat icon="trending-up" value={summaryStats.avgAttendance != null ? `${summaryStats.avgAttendance}%` : '—'} label="Avg Att." color={summaryStats.avgAttendance && summaryStats.avgAttendance >= 70 ? COLORS.success : COLORS.warning} loading={statsLoading} />
        </View>

        {/* Step 2: Period */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.stepBadge} accessibilityLabel="Step 2">
              <Text style={styles.stepBadgeText}>2</Text>
            </View>
            <Text style={styles.sectionTitle}>Select Period</Text>
          </View>

          <View style={styles.periodRow}>
            {PERIODS.map(p => {
              const active = selectedPeriod === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.periodCard, active && styles.periodCardActive]}
                  onPress={() => setSelectedPeriod(p.key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Icon name={p.icon} size={24} color={active ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[styles.periodLabel, active && styles.periodLabelActive]}>{p.label}</Text>
                  <Text style={[styles.periodDesc, active && styles.periodDescActive]}>{p.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Step 3: Report Types */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.stepBadge} accessibilityLabel="Step 3">
              <Text style={styles.stepBadgeText}>3</Text>
            </View>
            <Text style={styles.sectionTitle}>Report Contents</Text>
            <Text style={styles.sectionHint}>Select one or more</Text>
          </View>

          <View style={styles.typeGrid}>
            {REPORT_TYPES.map(rt => {
              const active = selectedTypes.has(rt.key);
              return (
                <TouchableOpacity
                  key={rt.key}
                  style={[styles.typeCard, active && { borderColor: rt.color, backgroundColor: `${rt.color}10` }]}
                  onPress={() => toggleType(rt.key)}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                >
                  <View style={styles.typeCardTop}>
                    <View style={[styles.typeIconWrap, { backgroundColor: `${rt.color}20` }]}>
                      <Icon name={rt.icon} size={20} color={rt.color} />
                    </View>
                    {active && (
                      <View style={[styles.typeCheck, { backgroundColor: rt.color }]}>
                        <Icon name="check" size={12} color="#fff" />
                      </View>
                    )}
                  </View>
                  <Text style={[styles.typeTitle, active && { color: rt.color }]}>{rt.title}</Text>
                  <Text style={styles.typeDesc} numberOfLines={2}>{rt.description}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Step 4: Format */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.stepBadge} accessibilityLabel="Step 4">
              <Text style={styles.stepBadgeText}>4</Text>
            </View>
            <Text style={styles.sectionTitle}>Export Format</Text>
          </View>

          <View style={styles.formatRow}>
            {FORMAT_OPTIONS.map(f => {
              const active = selectedFormat === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.formatCard, active && { borderColor: f.color, backgroundColor: `${f.color}10` }]}
                  onPress={() => setSelectedFormat(f.key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Icon name={f.icon} size={28} color={active ? f.color : COLORS.textMuted} />
                  <Text style={[styles.formatLabel, active && { color: f.color }]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Generate Button */}
        <View style={styles.generateSection}>
          <View style={styles.generateSummaryRow}>
            <Icon name="information-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.generateSummaryText}>
              {selectedDepartment || 'All'} · {selectedUnitLabel} · {periodLabel} · {selectedFormat.toUpperCase()}
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleGenerate}
            disabled={generating || !isOnline || reportUnitCodes.length === 0}
            activeOpacity={0.85}
            style={{ borderRadius: 14, overflow: 'hidden' }}
            accessibilityLabel="Generate report"
          >
            <LinearGradient
              colors={generating || !isOnline || reportUnitCodes.length === 0 ? ['#374151', '#374151'] : ['#4F46E5', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.generateBtn}
            >
              {generating ? (
                <>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.generateBtnText}>Generating...</Text>
                </>
              ) : (
                <>
                  <Icon name="file-export-outline" size={20} color="#fff" />
                  <Text style={styles.generateBtnText}>Generate Report</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
          
          {reportUnitCodes.length === 0 && !statsLoading && (
            <Text style={styles.warningText}>No units found for the selected department. Please sync your timetable.</Text>
          )}
        </View>

        {/* Recent Reports */}
        <View style={[styles.section, { marginBottom: SPACING.xxxl }]}>
          <View style={styles.sectionHeader}>
            <Icon name="history" size={16} color={COLORS.textSecondary} style={{ marginRight: SPACING.sm }} />
            <Text style={styles.sectionTitle}>Recently Generated</Text>
          </View>

          <View style={styles.recentList}>
            {recentLoading ? (
              <>
                <SkeletonRecentRow />
                <SkeletonRecentRow />
                <SkeletonRecentRow />
              </>
            ) : recentReports.length === 0 ? (
              <View style={styles.emptyRecent}>
                <Icon name="file-document-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyRecentTitle}>No reports yet</Text>
                <Text style={styles.emptyRecentSubtitle}>Generate your first report using the options above</Text>
              </View>
            ) : (
              recentReports.map((r, i) => (
                <RecentReportRow key={r.id || i} report={r} onOpen={setViewingReport} onDelete={deleteReport} onShare={shareReport} onDownload={downloadReport} />
              ))
            )}
          </View>
        </View>
      </Animated.ScrollView>

      <ReportViewerModal report={viewingReport} onClose={() => setViewingReport(null)} />
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxxl,
  },

  // Hero
  heroBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingTop: Platform.OS === 'ios' ? 20 : SPACING.xl,
    paddingBottom: SPACING.xxl,
  },
  heroLeft: {
    flex: 1,
    paddingRight: SPACING.lg,
  },

  heroSubtitle: {
    fontSize: FONT_SIZE.lg,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 18,
  },
  heroIconWrap: {
    opacity: 0.6,
  },

  // Summary Stats
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    gap: SPACING.sm,
  },
  summaryStatCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 90,
  },
  summaryStatIcon: {
    width: MIN_TOUCH_SIZE - 8,
    height: MIN_TOUCH_SIZE - 8,
    borderRadius: (MIN_TOUCH_SIZE - 8) / 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  summaryStatValue: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  summaryStatLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  // Sections
  section: {
    marginTop: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  stepBadge: {
    width: MIN_TOUCH_SIZE - 22,
    height: MIN_TOUCH_SIZE - 22,
    borderRadius: (MIN_TOUCH_SIZE - 22) / 2,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBadgeText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: '#fff',
  },
  sectionTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    flex: 1,
  },
  sectionHint: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
  },

  // Period Cards
  periodRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  periodCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    gap: SPACING.xs,
    minHeight: 90,
  },
  periodCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
    transform: [{ scale: 1.02 }],
  },
  periodLabel: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  periodLabelActive: {
    color: COLORS.primary,
  },
  periodDesc: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
  },
  periodDescActive: {
    color: COLORS.primaryLight,
  },

  // Type Grid
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  typeCard: {
    width: (SCREEN_WIDTH - SPACING.xxxl * 2) / 2 - SPACING.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: SPACING.md,
    minHeight: 120,
  },
  typeCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  typeIconWrap: {
    width: MIN_TOUCH_SIZE - 6,
    height: MIN_TOUCH_SIZE - 6,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  typeDesc: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    lineHeight: 15,
  },

  // Format Options
  formatRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  formatCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: 80,
  },
  formatLabel: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },

  // Generate Section
  generateSection: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.xxl,
    gap: SPACING.sm,
  },
  generateSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.xs,
  },
  generateSummaryText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.lg,
    borderRadius: 14,
    minHeight: MIN_TOUCH_SIZE + 8,
  },
  generateBtnText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  warningText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.warning,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  // Recent Reports
  recentList: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    minHeight: MIN_TOUCH_SIZE + 20,
  },
  recentRowTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  recentDeleteBtn: {
    paddingLeft: SPACING.sm,
    paddingRight: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  recentRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.xs,
    flexShrink: 0,
  },
  recentActionBtn: {
    padding: SPACING.sm,
  },
  recentIconWrap: {
    width: MIN_TOUCH_SIZE - 8,
    height: MIN_TOUCH_SIZE - 8,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recentInfo: {
    flex: 1,
  },
  recentTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  recentMeta: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
  },
  recentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  recentFormatBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
  },
  recentFormatText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },

  // Empty State
  emptyRecent: {
    alignItems: 'center',
    paddingVertical: SPACING.xxxl,
    paddingHorizontal: SPACING.xl,
  },
  emptyRecentTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  emptyRecentSubtitle: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },

  // Progress Modal
  progressOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 20,
    padding: SPACING.xxl,
    alignItems: 'center',
    width: SCREEN_WIDTH - 80,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  progressMessage: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textPrimary,
    marginTop: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  progressPercent: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },

  // Viewer Modal
  viewerContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  viewerTitle: {
    flex: 1,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  pdfViewer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  pdfLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
  viewerCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.xxxl,
  },
  viewerHint: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  viewerOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    minHeight: MIN_TOUCH_SIZE,
  },
  viewerOpenBtnText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: '#fff',
  },

  // Skeleton
  skeletonText: {
    backgroundColor: COLORS.border,
    borderRadius: 4,
  },

  // Department & Unit Picker
  deptSelectedNote: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
    marginLeft: 2,
    lineHeight: 16,
  },
  deptPillUnitName: {
    fontSize: FONT_SIZE.xs,
    color: 'rgba(255,255,255,0.8)',
    maxWidth: 100,
  },
  deptSectionLabel: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },
  deptScroll: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingVertical: 2,
    paddingHorizontal: 1,
  },
  deptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    minHeight: 36,
  },
  deptPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  deptPillText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
    maxWidth: 190,
  },
  deptPillTextActive: {
    color: '#fff',
  },
  unitFilterPill: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderLight,
  },
});