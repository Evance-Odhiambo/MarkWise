// C:\Users\evanc\Desktop\MarkWise\src\screens\lecturer\ClassManager\MaterialsScreen.js
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  FlatList,
  Animated,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Switch,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchMaterials, uploadMaterialWithProgress, editMaterial, deleteMaterial, getMaterialAnalytics, getMaterialViewers } from '../../../utils/materialsApi';
import { sendNotification } from '../../../utils/notificationApi';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import FilePicker from '../../../components/FilePicker';

import Share from 'react-native-share';
import { WebView } from 'react-native-webview';
import PDF from 'react-native-pdf';

import { useAuth } from '../../../context/AuthContext';
import { fetchLecturerUnits } from '../../../utils/unitsApi';
import { useColors } from '../../../theme';

const { height } = Dimensions.get('window');

// Per-unit cache — survives remounts and back-navigation.
const _materialsCache = new Map(); // unitId → { data: Material[], ts: number }
const MATERIALS_STALE_MS = 3 * 60 * 1000;

const toTitleCase = (str) =>
  str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());


// ─── Safe date formatters ────────────────────────────────────────────────────
const fmtDate = (val, fallback = '—') => {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d.toLocaleDateString();
};
const fmtDateTime = (val, opts, fallback = '—') => {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d.toLocaleString(undefined, opts);
};
const safeDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Enhanced Material Card
const EnhancedMaterialCard = ({ material, onEdit, onDelete, onShare, onView, onAnalytics, styles, colors }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [showMenu, setShowMenu] = useState(false);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      tension: 150,
      friction: 3,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 150,
      friction: 3,
    }).start();
  };

  const getIcon = () => {
    switch(material.type) {
      case 'file':
        if (material.fileType?.includes('pdf')) return 'file-pdf-box';
        if (material.fileType?.includes('video')) return 'video';
        if (material.fileType?.includes('audio')) return 'music';
        if (material.fileType?.includes('image')) return 'image';
        return 'file-document';
      case 'link': return 'link-variant';
      case 'text': return 'note-text';
      default: return 'file-document';
    }
  };

  const getIconColor = () => {
    switch(material.type) {
      case 'file':
        if (material.fileType?.includes('pdf')) return colors.danger.main;
        if (material.fileType?.includes('video')) return colors.purple.main;
        if (material.fileType?.includes('audio')) return colors.secondary.main;
        if (material.fileType?.includes('image')) return colors.success.main;
        return colors.primary.main;
      case 'link': return colors.info.main;
      case 'text': return colors.success.main;
      default: return colors.primary.main;
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <Animated.View style={[styles.materialCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onView}
        onLongPress={() => setShowMenu(true)}
        activeOpacity={0.9}
      >
        <View style={styles.materialHeader}>
          <LinearGradient
            colors={[getIconColor(), getIconColor() + '80']}
            style={styles.materialIconContainer}
          >
            <Icon name={getIcon()} size={28} color="#FFFFFF" />
          </LinearGradient>

          <View style={styles.materialContent}>
            <View style={styles.materialTitleRow}>
              <Text style={styles.materialTitle} numberOfLines={1}>{material.title}</Text>
              <LinearGradient
                colors={[colors.primary.soft, 'transparent']}
                style={styles.unitChip}
              >
                <Text style={styles.unitChipText}>{material.unitCode}</Text>
              </LinearGradient>
            </View>

            {material.description && (
              <Text style={styles.materialDescription} numberOfLines={2}>
                {material.description}
              </Text>
            )}

            <View style={styles.materialMeta}>
              <Icon name="clock-outline" size={12} color={colors.text.secondary} />
              <Text style={styles.materialMetaText}>
                {fmtDate(material.createdAt)}
              </Text>

              {!!material.fileSize && (
                <>
                  <Icon name="harddisk" size={12} color={colors.text.secondary} />
                  <Text style={styles.materialMetaText}>
                    {formatFileSize(material.fileSize)}
                  </Text>
                </>
              )}

              <Icon name="eye" size={12} color={colors.text.secondary} />
              <Text style={styles.materialMetaText}>
                {material.views || 0} views
              </Text>
            </View>

            {/* Tags */}
            {material.tags && material.tags.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagsContainer}>
                {material.tags.map((tag, index) => (
                  <View key={index} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.materialActions}>
        <TouchableOpacity
          style={styles.materialActionButton}
          onPress={() => onAnalytics(material)}
        >
          <LinearGradient
            colors={[colors.purple.soft, 'transparent']}
            style={styles.materialActionGradient}
          >
            <Icon name="chart-line" size={18} color={colors.purple.main} />
            <Text style={[styles.materialActionText, { color: colors.purple.main }]}>Stats</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.materialActionButton}
          onPress={() => onShare(material)}
        >
          <LinearGradient
            colors={[colors.info.soft, 'transparent']}
            style={styles.materialActionGradient}
          >
            <Icon name="share" size={18} color={colors.info.main} />
            <Text style={[styles.materialActionText, { color: colors.info.main }]}>Share</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.materialActionButton}
          onPress={() => onEdit(material)}
        >
          <LinearGradient
            colors={[colors.warning.soft, 'transparent']}
            style={styles.materialActionGradient}
          >
            <Icon name="pencil" size={18} color={colors.warning.main} />
            <Text style={[styles.materialActionText, { color: colors.warning.main }]}>Edit</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.materialActionButton}
          onPress={() => onDelete(material.id)}
        >
          <LinearGradient
            colors={[colors.danger.soft, 'transparent']}
            style={styles.materialActionGradient}
          >
            <Icon name="delete" size={18} color={colors.danger.main} />
            <Text style={[styles.materialActionText, { color: colors.danger.main }]}>Delete</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Context Menu Modal */}
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View style={styles.contextMenu}>
            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setShowMenu(false);
                onView(material);
              }}
            >
              <Icon name="eye" size={20} color={colors.primary.main} />
              <Text style={styles.contextMenuItemText}>Preview</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setShowMenu(false);
                const url = material.url || material.fileUrl || material.linkUrl || '';
                if (url) Linking.openURL(url).catch(() => {});
                else onView(material);
              }}
            >
              <Icon name="download" size={20} color={colors.success.main} />
              <Text style={styles.contextMenuItemText}>Download</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setShowMenu(false);
                // Duplicate material
              }}
            >
              <Icon name="content-copy" size={20} color={colors.info.main} />
              <Text style={styles.contextMenuItemText}>Duplicate</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Animated.View>
  );
};

// Material Viewer Modal
const MaterialViewerModal = ({ visible, onClose, material, styles, colors }) => {
  if (!material) return null;

  const renderContent = () => {
    switch(material.type) {
      case 'file':
        if (material.fileType?.includes('video')) {
          return (
            <WebView
              source={{ uri: material.url }}
              style={styles.videoPlayer}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              allowsFullscreenVideo
            />
          );
        }
        if (material.fileType?.includes('pdf')) {
          return (
            <PDF
              source={{ uri: material.url }}
              style={styles.pdfViewer}
            />
          );
        }
        return (
          <View style={styles.filePreview}>
            <Icon name="file-document" size={64} color={colors.primary.main} />
            <Text style={styles.fileName}>{material.title}</Text>
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={() => {
                const url = material.url || material.fileUrl || '';
                if (url) Linking.openURL(url).catch(() =>
                  Alert.alert('Cannot open', 'Unable to open this file.')
                );
              }}
            >
              <LinearGradient
                colors={colors.primary.gradient}
                style={styles.downloadButtonGradient}
              >
                <Icon name="download" size={20} color="#FFFFFF" />
                <Text style={styles.downloadButtonText}>Download</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        );

      case 'link':
        return (
          <View style={styles.linkPreview}>
            <Icon name="link-variant" size={64} color={colors.info.main} />
            <Text style={styles.linkUrl}>{material.linkUrl}</Text>
            <TouchableOpacity
              style={styles.openLinkButton}
              onPress={() => {
                const url = material.linkUrl || '';
                if (url) Linking.openURL(url).catch(() =>
                  Alert.alert('Cannot open', 'Unable to open this link.')
                );
              }}
            >
              <LinearGradient
                colors={colors.info.gradient}
                style={styles.openLinkButtonGradient}
              >
                <Icon name="open-in-new" size={20} color="#FFFFFF" />
                <Text style={styles.openLinkButtonText}>Open Link</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        );

      case 'text':
        return (
          <ScrollView style={styles.textContent}>
            <Text style={styles.textContentText}>{material.text}</Text>
          </ScrollView>
        );

      default:
        return null;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: height * 0.9 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{material.title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.viewerContainer}>
            {renderContent()}
          </View>
        </View>
      </View>
    </Modal>
  );
};

// Material Analytics Modal
const MaterialAnalyticsModal = ({ visible, onClose, material, styles, colors }) => {
  const [viewers, setViewers] = React.useState([]);
  const [viewersLoading, setViewersLoading] = React.useState(false);

  React.useEffect(() => {
    if (!visible || !material?.id) return;
    setViewersLoading(true);
    getMaterialViewers(material.id)
      .then(setViewers)
      .catch(() => setViewers([]))
      .finally(() => setViewersLoading(false));
  }, [visible, material?.id]);

  if (!material) return null;

  const viewsByDay = material.viewsByDay || [];
  const totalViews = material.views || 0;
  const uniqueViewers = material.uniqueViewers || 0;
  const averageTimeSpent = material.averageTimeSpent || 0;
  const downloads = material.downloads || 0;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: height * 0.8 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Material Analytics</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={styles.analyticsTitle}>{material.title}</Text>

            {/* Key Metrics */}
            <View style={styles.metricsGrid}>
              <LinearGradient
                colors={[colors.primary.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="eye" size={24} color={colors.primary.main} />
                <Text style={styles.metricValue}>{totalViews}</Text>
                <Text style={styles.metricLabel}>Total Views</Text>
              </LinearGradient>

              <LinearGradient
                colors={[colors.success.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="account-group" size={24} color={colors.success.main} />
                <Text style={styles.metricValue}>{uniqueViewers}</Text>
                <Text style={styles.metricLabel}>Unique Viewers</Text>
              </LinearGradient>

              <LinearGradient
                colors={[colors.info.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="clock-outline" size={24} color={colors.info.main} />
                <Text style={styles.metricValue}>{averageTimeSpent}m</Text>
                <Text style={styles.metricLabel}>Avg Time</Text>
              </LinearGradient>

              <LinearGradient
                colors={[colors.warning.soft, 'transparent']}
                style={styles.metricCard}
              >
                <Icon name="download" size={24} color={colors.warning.main} />
                <Text style={styles.metricValue}>{downloads}</Text>
                <Text style={styles.metricLabel}>Downloads</Text>
              </LinearGradient>
            </View>

            {/* Views Timeline */}
            <Text style={styles.chartTitle}>Views Over Time</Text>
            <View style={styles.timelineContainer}>
              {viewsByDay.map((day, index) => (
                <View key={index} style={styles.timelineItem}>
                  <Text style={styles.timelineDate}>{day.date}</Text>
                  <View style={styles.timelineBarContainer}>
                    <View
                      style={[
                        styles.timelineBar,
                        { width: `${(day.count / Math.max(...viewsByDay.map(d => d.count), 1)) * 100}%` }
                      ]}
                    />
                  </View>
                  <Text style={styles.timelineCount}>{day.count}</Text>
                </View>
              ))}
            </View>

            {/* Viewer Demographics */}
            {material.viewerDemographics && (
              <>
                <Text style={styles.chartTitle}>Viewer Demographics</Text>
                <View style={styles.demographicsContainer}>
                  <View style={styles.demographicItem}>
                    <Text style={styles.demographicLabel}>Students</Text>
                    <View style={styles.demographicBarContainer}>
                      <View
                        style={[
                          styles.demographicBar,
                          { width: `${material.viewerDemographics.students}%` }
                        ]}
                      />
                    </View>
                    <Text style={styles.demographicValue}>{material.viewerDemographics.students}%</Text>
                  </View>

                  <View style={styles.demographicItem}>
                    <Text style={styles.demographicLabel}>Lecturers</Text>
                    <View style={styles.demographicBarContainer}>
                      <View
                        style={[
                          styles.demographicBar,
                          { width: `${material.viewerDemographics.lecturers}%` }
                        ]}
                      />
                    </View>
                    <Text style={styles.demographicValue}>{material.viewerDemographics.lecturers}%</Text>
                  </View>

                  <View style={styles.demographicItem}>
                    <Text style={styles.demographicLabel}>Other</Text>
                    <View style={styles.demographicBarContainer}>
                      <View
                        style={[
                          styles.demographicBar,
                          { width: `${material.viewerDemographics.other}%` }
                        ]}
                      />
                    </View>
                    <Text style={styles.demographicValue}>{material.viewerDemographics.other}%</Text>
                  </View>
                </View>
              </>
            )}

            {/* Who Viewed */}
            <Text style={styles.chartTitle}>Who Viewed</Text>
            {viewersLoading ? (
              <ActivityIndicator size="small" color={colors.primary.main} style={{ marginVertical: 16 }} />
            ) : viewers.length === 0 ? (
              <View style={styles.noViewersBox}>
                <Icon name="eye-off-outline" size={32} color={colors.text.secondary} />
                <Text style={styles.noViewersText}>No views recorded yet</Text>
              </View>
            ) : (
              viewers.map((v, i) => (
                <View key={v.studentId ?? i} style={styles.viewerRow}>
                  <View style={styles.viewerAvatar}>
                    <Text style={styles.viewerAvatarText}>
                      {(v.name || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.viewerName}>{v.name || '—'}</Text>
                    <Text style={styles.viewerMeta}>
                      {v.admissionNumber ? `${v.admissionNumber} · ` : ''}
                      {v.viewedAt ? fmtDateTime(v.viewedAt, { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                    </Text>
                  </View>
                  {v.timeSpentSeconds != null && (
                    <View style={styles.viewerTimeBadge}>
                      <Icon name="clock-outline" size={12} color={colors.info.main} />
                      <Text style={styles.viewerTimeText}>
                        {v.timeSpentSeconds < 60
                          ? `${v.timeSpentSeconds}s`
                          : `${Math.round(v.timeSpentSeconds / 60)}m`}
                      </Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

// Enhanced Material Upload Modal
const EnhancedMaterialUploadModal = ({ visible, onClose, onSubmit, editingMaterial, units = [], initialUnitId = '', styles, colors }) => {
  const [filePickerVisible, setFilePickerVisible] = useState(false);
  const [unitPickerVisible, setUnitPickerVisible] = useState(false);
  const [formData, setFormData] = useState({
    unitId: initialUnitId,
    title: '',
    description: '',
    type: 'file',
    file: null,
    linkUrl: '',
    text: '',
    tags: [],
    isPublic: true,
    notifyStudents: true,
    allowDownload: true,
    expiryDate: null,
  });

  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (editingMaterial) {
      setFormData({
        unitId: editingMaterial.unitId || initialUnitId,
        title: editingMaterial.title || '',
        description: editingMaterial.description || '',
        type: editingMaterial.type || 'file',
        file: null,
        linkUrl: editingMaterial.linkUrl || '',
        text: editingMaterial.text || '',
        tags: editingMaterial.tags || [],
        isPublic: editingMaterial.isPublic ?? true,
        notifyStudents: true,
        allowDownload: editingMaterial.allowDownload ?? true,
        expiryDate: editingMaterial.expiryDate || null,
      });
    } else {
      setFormData({
        unitId: initialUnitId,
        title: '',
        description: '',
        type: 'file',
        file: null,
        linkUrl: '',
        text: '',
        tags: [],
        isPublic: true,
        notifyStudents: true,
        allowDownload: true,
        expiryDate: null,
      });
    }
  }, [editingMaterial]);

  const handleFilePick = () => setFilePickerVisible(true);

  const handleSubmit = async () => {
    if (!formData.unitId) {
      Alert.alert('Error', 'Please select a unit');
      return;
    }

    if (formData.type === 'file' && !formData.file && !editingMaterial) {
      Alert.alert('Error', 'Please select a file');
      return;
    }

    if (formData.type === 'link' && !formData.linkUrl) {
      Alert.alert('Error', 'Please enter a URL');
      return;
    }

    if (formData.type === 'text' && !formData.text) {
      Alert.alert('Error', 'Please enter some text');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    try {
      await onSubmit(formData, (pct) => setUploadProgress(pct));
      setUploadProgress(0);
      setIsUploading(false);
    } catch (err) {
      setIsUploading(false);
      setUploadProgress(0);
      Alert.alert('Error', err.message || 'Failed to save material');
    }
  };

  return (
    <>
    <FilePicker
      visible={filePickerVisible}
      onClose={() => setFilePickerVisible(false)}
      onSelect={(files) => {
        const file = files[0];
        setFormData(f => ({ ...f, file: { uri: file.uri, name: file.name, type: file.type, size: file.size } }));
      }}
      multiple={false}
    />
    {/* Unit Picker Sheet */}
    <Modal visible={unitPickerVisible} transparent animationType="fade" onRequestClose={() => setUnitPickerVisible(false)}>
      <TouchableOpacity style={styles.unitDropdownOverlay} activeOpacity={1} onPress={() => setUnitPickerVisible(false)}>
        <View style={styles.unitDropdownContent}>
          <View style={styles.unitDropdownHeader}>
            <Text style={styles.unitDropdownTitle}>Select Unit</Text>
            <TouchableOpacity onPress={() => setUnitPickerVisible(false)}>
              <Icon name="close" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={units}
            keyExtractor={item => String(item.unitId || item.code)}
            renderItem={({ item }) => {
              const isActive = item.unitId === formData.unitId || item.code === formData.unitId;
              return (
                <TouchableOpacity onPress={() => { setFormData(f => ({ ...f, unitId: item.unitId || item.code })); setUnitPickerVisible(false); }}>
                  <LinearGradient
                    colors={isActive ? colors.primary.gradient : ['transparent', 'transparent']}
                    style={styles.unitItemGradient}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.unitItemCode, isActive && styles.unitItemTextActive]}>{item.code}</Text>
                      {!!item.name && <Text style={[styles.unitItemName, isActive && styles.unitItemSubtextActive]}>{item.name}</Text>}
                    </View>
                    {isActive && <Icon name="check-circle" size={20} color="#FFFFFF" />}
                  </LinearGradient>
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border.light, marginHorizontal: 16 }} />}
            ListEmptyComponent={<Text style={styles.unitEmptyText}>No assigned units found</Text>}
          />
        </View>
      </TouchableOpacity>
    </Modal>
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMaterial ? 'Edit Material' : 'Upload Material'}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Icon name="close" size={24} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <Text style={styles.inputLabel}>Unit <Text style={styles.requiredStar}>*</Text></Text>
              <TouchableOpacity
                style={styles.unitPickerButton}
                onPress={() => setUnitPickerVisible(true)}
                activeOpacity={0.7}
              >
                <Icon name="book-education-outline" size={16} color={colors.primary.main} />
                <Text style={styles.unitPickerButtonText} numberOfLines={1}>
                  {(() => {
                    const u = units.find(x => x.unitId === formData.unitId || x.code === formData.unitId);
                    return u?.display || u?.code || u?.name || formData.unitId || 'Tap to select unit';
                  })()}
                </Text>
                <Icon name="chevron-down" size={20} color={colors.primary.main} />
              </TouchableOpacity>

              <Text style={styles.inputLabel}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Material title (optional — defaults to file name)"
                placeholderTextColor={colors.text.tertiary}
                value={formData.title}
                onChangeText={t => setFormData(f => ({ ...f, title: t }))}
              />

              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Describe the material..."
                placeholderTextColor={colors.text.tertiary}
                value={formData.description}
                onChangeText={t => setFormData(f => ({ ...f, description: t }))}
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.inputLabel}>Type</Text>
              <View style={styles.typeContainer}>
                {['file', 'link', 'text'].map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeButton,
                      formData.type === type && styles.typeButtonActive
                    ]}
                    onPress={() => setFormData(f => ({ ...f, type }))}
                  >
                    <LinearGradient
                      colors={formData.type === type ? colors.primary.gradient : ['transparent', 'transparent']}
                      style={styles.typeButtonGradient}
                    >
                      <Text style={formData.type === type ? styles.typeButtonTextActive : styles.typeButtonText}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>

              {formData.type === 'file' && (
                <>
                  <TouchableOpacity
                    style={styles.filePickerButton}
                    onPress={handleFilePick}
                    disabled={isUploading}
                  >
                    <LinearGradient
                      colors={[colors.primary.soft, 'transparent']}
                      style={styles.filePickerGradient}
                    >
                      <Icon name="file-upload" size={24} color={colors.primary.main} />
                      <Text style={styles.filePickerText}>
                        {formData.file ? formData.file.name : 'Tap to select file'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  {formData.file && (
                    <View style={styles.fileInfo}>
                      <Icon name="file-document" size={20} color={colors.info.main} />
                      <Text style={styles.fileName}>{formData.file.name}</Text>
                      <Text style={styles.fileSize}>
                        {(formData.file.size / 1024 / 1024).toFixed(2)} MB
                      </Text>
                    </View>
                  )}
                </>
              )}

              {formData.type === 'link' && (
                <TextInput
                  style={styles.input}
                  placeholder="https://example.com/document.pdf"
                  placeholderTextColor={colors.text.tertiary}
                  value={formData.linkUrl}
                  onChangeText={t => setFormData(f => ({ ...f, linkUrl: t }))}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}

              {formData.type === 'text' && (
                <TextInput
                  style={[styles.input, styles.textArea, { height: 150 }]}
                  placeholder="Paste or type your content here..."
                  placeholderTextColor={colors.text.tertiary}
                  value={formData.text}
                  onChangeText={t => setFormData(f => ({ ...f, text: t }))}
                  multiline
                  textAlignVertical="top"
                />
              )}

              {/* Tags */}
              <Text style={styles.inputLabel}>Tags (comma separated)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., lecture, important, exam"
                placeholderTextColor={colors.text.tertiary}
                value={formData.tags.join(', ')}
                onChangeText={t => setFormData(f => ({ ...f, tags: t.split(',').map(s => s.trim()) }))}
              />

              {/* Settings */}
              <Text style={styles.sectionTitle}>Settings</Text>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="eye" size={24} color={colors.primary.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Public</Text>
                    <Text style={styles.settingDescription}>Visible to all students</Text>
                  </View>
                </View>
                <Switch
                  value={formData.isPublic}
                  onValueChange={(value) => setFormData(f => ({ ...f, isPublic: value }))}
                  trackColor={{ false: colors.surface.tertiary, true: colors.primary.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="bell" size={24} color={colors.warning.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Notify Students</Text>
                    <Text style={styles.settingDescription}>Send notification about new material</Text>
                  </View>
                </View>
                <Switch
                  value={formData.notifyStudents}
                  onValueChange={(value) => setFormData(f => ({ ...f, notifyStudents: value }))}
                  trackColor={{ false: colors.surface.tertiary, true: colors.warning.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingInfo}>
                  <Icon name="download" size={24} color={colors.success.main} />
                  <View style={styles.settingText}>
                    <Text style={styles.settingTitle}>Allow Download</Text>
                    <Text style={styles.settingDescription}>Students can download this material</Text>
                  </View>
                </View>
                <Switch
                  value={formData.allowDownload}
                  onValueChange={(value) => setFormData(f => ({ ...f, allowDownload: value }))}
                  trackColor={{ false: colors.surface.tertiary, true: colors.success.main }}
                  thumbColor={colors.text.primary}
                />
              </View>

              {/* Upload Progress */}
              {isUploading && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${uploadProgress}%` }]} />
                  </View>
                  <Text style={styles.progressText}>{uploadProgress}% uploaded</Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onClose}
                disabled={isUploading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.createButton, isUploading && styles.disabledButton]}
                onPress={handleSubmit}
                disabled={isUploading}
              >
                <LinearGradient
                  colors={isUploading ? ['#6B7280', '#4B5563'] : colors.success.gradient}
                  style={styles.createButtonGradient}
                >
                  <Text style={styles.createButtonText}>
                    {isUploading ? 'Uploading...' : (editingMaterial ? 'Save Changes' : 'Upload')}
                  </Text>
                  {!isUploading && <Icon name="check" size={20} color="#FFFFFF" />}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    </>
  );
};

// Bulk Upload Modal
const BulkUploadModal = ({ visible, onClose, onUpload, styles, colors }) => {
  const [filePickerVisible, setFilePickerVisible] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleSelectFiles = () => setFilePickerVisible(true);

  const handleUpload = async () => {
    if (files.length === 0) {
      Alert.alert('Error', 'Please select files to upload');
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      await onUpload(files, (pct) => setProgress(pct));
    } catch (err) {
      setUploading(false);
      Alert.alert('Error', err.message || 'Failed to upload files');
      return;
    }
    setUploading(false);
    setFiles([]);
    setProgress(0);
    onClose();
  };

  return (
    <>
    <FilePicker
      visible={filePickerVisible}
      onClose={() => setFilePickerVisible(false)}
      onSelect={(picked) => setFiles(picked.map(f => ({ uri: f.uri, name: f.name, type: f.type, size: f.size })))}
      multiple
    />
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: height * 0.8 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Bulk Upload Materials</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <TouchableOpacity
              style={styles.selectFilesButton}
              onPress={handleSelectFiles}
              disabled={uploading}
            >
              <LinearGradient
                colors={[colors.primary.soft, 'transparent']}
                style={styles.selectFilesGradient}
              >
                <Icon name="file-multiple" size={32} color={colors.primary.main} />
                <Text style={styles.selectFilesText}>
                  {files.length > 0 ? `${files.length} files selected` : 'Tap to select files'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {files.map((file, index) => (
              <View key={index} style={styles.selectedFile}>
                <Icon name="file-document" size={20} color={colors.info.main} />
                <Text style={styles.selectedFileName} numberOfLines={1}>
                  {file.name}
                </Text>
                <TouchableOpacity onPress={() => {
                  const newFiles = [...files];
                  newFiles.splice(index, 1);
                  setFiles(newFiles);
                }}>
                  <Icon name="close-circle" size={20} color={colors.danger.main} />
                </TouchableOpacity>
              </View>
            ))}

            {uploading && (
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
                <Text style={styles.progressText}>{progress}% uploaded</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={uploading}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.createButton, uploading && styles.disabledButton]}
              onPress={handleUpload}
              disabled={uploading || files.length === 0}
            >
              <LinearGradient
                colors={uploading ? ['#6B7280', '#4B5563'] : colors.success.gradient}
                style={styles.createButtonGradient}
              >
                <Text style={styles.createButtonText}>
                  {uploading ? 'Uploading...' : `Upload ${files.length} Files`}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
};

// Main MaterialsScreen Component
export default function MaterialsScreen({
  route,
  selectedUnitId: propUnitId,
  assignedUnits: propUnits,
  onRefresh: parentRefresh,
  refreshing: parentRefreshing = false
}) {
  const { user } = useAuth();
  const colors = useColors();
  const C = useMemo(() => ({
    bg:               colors.background.primary,
    surfacePrimary:   colors.surface.primary,
    surfaceSecondary: colors.surface.secondary,
    surfaceTertiary:  colors.surface.tertiary,
    textPrimary:      colors.text.primary,
    textSecondary:    colors.text.secondary,
    textTertiary:     colors.text.tertiary,
    borderLight:      colors.border.light,
    primaryMain:      colors.primary.main,
    primarySoft:      colors.primary.soft,
    primaryGradient:  colors.primary.gradient,
    successMain:      colors.success.main,
    successSoft:      colors.success.soft,
    successGradient:  colors.success.gradient,
    warningMain:      colors.warning.main,
    warningSoft:      colors.warning.soft,
    dangerMain:       colors.danger.main,
    dangerSoft:       colors.danger.soft,
    infoMain:         colors.info.main,
    infoSoft:         colors.info.soft,
    purpleMain:       colors.purple.main,
    purpleSoft:       colors.purple.soft,
    overlayMedium:    colors.overlay.medium,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const [selectedUnitId, setSelectedUnitId] = useState(propUnitId ?? route?.params?.selectedUnitId ?? '');
  const [units, setUnits] = useState(() => {
    const passed = propUnits ?? route?.params?.assignedUnits ?? [];
    return Array.isArray(passed) ? passed : [];
  });
  const [unitDropdownVisible, setUnitDropdownVisible] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialModalVisible, setMaterialModalVisible] = useState(false);
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [viewerModalVisible, setViewerModalVisible] = useState(false);
  const [analyticsModalVisible, setAnalyticsModalVisible] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date'); // date, title, views

  // Fetch lecturer units if not provided via props/route
  useEffect(() => {
    const passedUnits = propUnits ?? route?.params?.assignedUnits ?? [];
    if ((!Array.isArray(passedUnits) || passedUnits.length === 0) && user?.lecturerId) {
      fetchLecturerUnits(user.lecturerId)
        .then(data => {
          const arr = Array.isArray(data) ? data : (data?.units || []);
          const mapped = arr.map(u => {
            // Use unit code only — never fall back to DB id (u.unitId/u.unit_id)
            const rawCode = u.unit_code || u.unitCode || u.code || '';
            const normalizedCode = String(rawCode).replace(/\s+/g, '').toUpperCase();
            return {
              unitId: normalizedCode,
              code: normalizedCode,
              name: toTitleCase(String(u.unit_name || u.unitName || u.unitTitle || u.name || '')),
              display: [rawCode, toTitleCase(String(u.unit_name || u.unitName || u.unitTitle || u.name || ''))].filter(Boolean).join(' - '),
            };
          });
          setUnits(mapped);
          if (!selectedUnitId && mapped.length > 0) {
            setSelectedUnitId(mapped[0].unitId);
          }
        })
        .catch(err => console.error('[MaterialsScreen] fetch units error:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.lecturerId]);

  // Load materials for a unit — stale-while-revalidate via module-level cache.
  const loadMaterials = useCallback(async (unitId, force = false) => {
    if (!unitId) return;
    const cached = _materialsCache.get(unitId);
    if (cached) setMaterials(cached.data);
    if (!force && cached && Date.now() - cached.ts < MATERIALS_STALE_MS) return;
    if (!cached) setMaterialsLoading(true);
    try {
      const data = await fetchMaterials(unitId);
      const enriched = await Promise.all(
        (Array.isArray(data) ? data : []).map(async (material) => {
          try { return { ...material, ...await getMaterialAnalytics(material.id) }; }
          catch { return material; }
        })
      );
      _materialsCache.set(unitId, { data: enriched, ts: Date.now() });
      setMaterials(enriched);
    } catch (err) {
      console.error('Error loading materials:', err);
      if (!cached) {
        Alert.alert('Error', err.message || 'Failed to load materials');
        setMaterials([]);
      }
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  // Load data when selectedUnitId changes
  useEffect(() => {
    if (selectedUnitId) {
      loadMaterials(selectedUnitId);
    }
  }, [selectedUnitId, loadMaterials]);

  useEffect(() => {
    if (route?.params?.openUploadModal) {
      setMaterialModalVisible(true);
    }
  }, [route?.params?.openUploadModal]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (selectedUnitId) {
      _materialsCache.delete(selectedUnitId);
      await loadMaterials(selectedUnitId, true);
    }
    if (parentRefresh) await parentRefresh();
    setRefreshing(false);
  }, [selectedUnitId, loadMaterials, parentRefresh]);

  // Filter and sort materials — memoized to avoid recomputing on every render.
  const getFilteredMaterials = useMemo(() => {
    let filtered = [...materials];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.tags?.some(tag => tag.toLowerCase().includes(q))
      );
    }
    if (filterType !== 'all') {
      filtered = filtered.filter(m => m.type === filterType);
    }
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'title':  return a.title.localeCompare(b.title);
        case 'views':  return (b.views || 0) - (a.views || 0);
        case 'date':
        default:       return (safeDate(b.createdAt) || 0) - (safeDate(a.createdAt) || 0);
      }
    });
    return filtered;
  }, [materials, searchQuery, filterType, sortBy]);

  // Material handlers
  const handleMaterialSubmit = async (formData, onProgress) => {
    if (editingMaterial) {
      await editMaterial(editingMaterial.id, formData);
      Alert.alert('Success', 'Material updated successfully');
    } else {
      const targetUnitId = formData.unitId || selectedUnitId;
      await uploadMaterialWithProgress(targetUnitId, formData, onProgress);

      // Send notification if enabled — fire-and-forget so a notification
      // failure never surfaces as an upload error to the lecturer
      if (formData.notifyStudents) {
        sendNotification({
          type: 'material_uploaded',
          title: 'New Material Available',
          message: 'A new material has been uploaded.',
          recipients: [targetUnitId],
          data: {},
        }).catch(err => console.warn('[MaterialsScreen] sendNotification failed:', err));
      }

      Alert.alert('Success', 'Material uploaded successfully');
    }
    setMaterialModalVisible(false);
    setEditingMaterial(null);
    const reloadUnitId = formData.unitId || selectedUnitId;
    if (reloadUnitId !== selectedUnitId) setSelectedUnitId(reloadUnitId);
    _materialsCache.delete(reloadUnitId);
    loadMaterials(reloadUnitId, true);
  };

  const handleBulkUpload = async (files, onProgress) => {
    try {
      // Upload files sequentially so we can report fine-grained progress
      for (let i = 0; i < files.length; i++) {
        await uploadMaterialWithProgress(selectedUnitId, { type: 'file', file: files[i] }, (pct) => {
          const overall = Math.round(((i + pct / 100) / files.length) * 100);
          onProgress?.(overall);
        });
      }
      Alert.alert('Success', `${files.length} material${files.length !== 1 ? 's' : ''} uploaded successfully`);
      _materialsCache.delete(selectedUnitId);
      loadMaterials(selectedUnitId, true);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to upload materials');
    }
  };

  const handleDeleteMaterial = (materialId) => {
    Alert.alert(
      'Delete Material',
      'Are you sure you want to delete this material?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMaterial(materialId);
              Alert.alert('Success', 'Material deleted successfully');
              _materialsCache.delete(selectedUnitId);
              loadMaterials(selectedUnitId, true);
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to delete material');
            }
          }
        }
      ]
    );
  };

  const handleShareMaterial = async (material) => {
    try {
      await Share.open({
        title: material.title,
        message: material.description || material.title,
        url: material.url || material.linkUrl,
      });
    } catch (err) {
      if (!err.message.includes('CANCELLED')) {
        Alert.alert('Error', 'Failed to share material');
      }
    }
  };

  const handleViewMaterial = (material) => {
    setSelectedMaterial(material);
    setViewerModalVisible(true);
  };

  const handleViewAnalytics = (material) => {
    setSelectedMaterial(material);
    setAnalyticsModalVisible(true);
  };

  const filteredMaterials = getFilteredMaterials;
  const activeUnitObj = units.find(u => u.unitId === selectedUnitId || u.code === selectedUnitId);
  const activeUnitDisplay = activeUnitObj?.display || activeUnitObj?.name || activeUnitObj?.code || selectedUnitId || 'Select a unit';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Unit Dropdown Modal */}
      <Modal visible={unitDropdownVisible} transparent animationType="fade" onRequestClose={() => setUnitDropdownVisible(false)}>
        <TouchableOpacity style={styles.unitDropdownOverlay} activeOpacity={1} onPress={() => setUnitDropdownVisible(false)}>
          <View style={styles.unitDropdownContent}>
            <View style={styles.unitDropdownHeader}>
              <Text style={styles.unitDropdownTitle}>Select Unit</Text>
              <TouchableOpacity onPress={() => setUnitDropdownVisible(false)}>
                <Icon name="close" size={22} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={units}
              keyExtractor={item => String(item.unitId || item.code)}
              renderItem={({ item }) => {
                const isActive = item.unitId === selectedUnitId || item.code === selectedUnitId;
                return (
                  <TouchableOpacity
                    onPress={() => { setSelectedUnitId(item.unitId || item.code); setUnitDropdownVisible(false); }}
                  >
                    <LinearGradient
                      colors={isActive ? colors.primary.gradient : ['transparent', 'transparent']}
                      style={styles.unitItemGradient}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.unitItemCode, isActive && styles.unitItemTextActive]}>{item.code}</Text>
                        {!!item.name && <Text style={[styles.unitItemName, isActive && styles.unitItemSubtextActive]}>{item.name}</Text>}
                      </View>
                      {isActive && <Icon name="check-circle" size={20} color="#FFFFFF" />}
                    </LinearGradient>
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border.light, marginHorizontal: 16 }} />}
              ListEmptyComponent={<Text style={styles.unitEmptyText}>No assigned units found</Text>}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header with Filters */}
      <View style={styles.filterHeader}>
        {/* Unit Selector */}
        <TouchableOpacity style={styles.unitSelectorBar} onPress={() => setUnitDropdownVisible(true)} activeOpacity={0.7}>
          <Icon name="book-education-outline" size={16} color={colors.primary.main} />
          <Text style={styles.unitSelectorText} numberOfLines={1}>{activeUnitDisplay}</Text>
          <Icon name="chevron-down" size={20} color={colors.primary.main} />
        </TouchableOpacity>

        <View style={styles.searchContainer}>
          <Icon name="magnify" size={20} color={colors.text.secondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search materials..."
            placeholderTextColor={colors.text.tertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close" size={20} color={colors.text.secondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
        >
          <TouchableOpacity
            style={[styles.filterChip, filterType === 'all' && styles.filterChipActive]}
            onPress={() => setFilterType('all')}
          >
            <Text style={[styles.filterChipText, filterType === 'all' && styles.filterChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterType === 'file' && styles.filterChipActive]}
            onPress={() => setFilterType('file')}
          >
            <Text style={[styles.filterChipText, filterType === 'file' && styles.filterChipTextActive]}>
              Files
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterType === 'link' && styles.filterChipActive]}
            onPress={() => setFilterType('link')}
          >
            <Text style={[styles.filterChipText, filterType === 'link' && styles.filterChipTextActive]}>
              Links
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterType === 'text' && styles.filterChipActive]}
            onPress={() => setFilterType('text')}
          >
            <Text style={[styles.filterChipText, filterType === 'text' && styles.filterChipTextActive]}>
              Notes
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.sortContainer}>
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => setSortBy('date')}
          >
            <Icon name="calendar" size={16} color={sortBy === 'date' ? colors.primary.main : colors.text.secondary} />
            <Text style={[styles.sortButtonText, sortBy === 'date' && styles.sortButtonTextActive]}>
              Date
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => setSortBy('title')}
          >
            <Icon name="sort-alphabetical" size={16} color={sortBy === 'title' ? colors.primary.main : colors.text.secondary} />
            <Text style={[styles.sortButtonText, sortBy === 'title' && styles.sortButtonTextActive]}>
              Title
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => setSortBy('views')}
          >
            <Icon name="eye" size={16} color={sortBy === 'views' ? colors.primary.main : colors.text.secondary} />
            <Text style={[styles.sortButtonText, sortBy === 'views' && styles.sortButtonTextActive]}>
              Views
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => {
            setEditingMaterial(null);
            setMaterialModalVisible(true);
          }}
        >
          <LinearGradient
            colors={colors.primary.gradient}
            style={styles.createButtonGradient}
          >
            <Icon name="upload" size={20} color="#FFFFFF" />
            <Text style={styles.createButtonText}>Upload</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bulkButton}
          onPress={() => setBulkModalVisible(true)}
        >
          <LinearGradient
            colors={[colors.info.soft, 'transparent']}
            style={styles.bulkButtonGradient}
          >
            <Icon name="file-multiple" size={20} color={colors.info.main} />
            <Text style={styles.bulkButtonText}>Bulk Upload</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {materialsLoading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.primary.main} />
        </View>
      ) : filteredMaterials.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || parentRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary.main}
              colors={[colors.primary.main]}
            />
          }
        >
          <LinearGradient
            colors={[colors.primary.soft, 'transparent']}
            style={styles.emptyIconContainer}
          >
            <Icon name="file-document-outline" size={64} color={colors.primary.main} />
          </LinearGradient>
          <Text style={styles.emptyTitle}>No Materials</Text>
          <Text style={styles.emptyText}>Upload study materials for your students</Text>
        </ScrollView>
      ) : (
        <FlatList
          data={filteredMaterials}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <EnhancedMaterialCard
              material={item}
              onEdit={(material) => {
                setEditingMaterial(material);
                setMaterialModalVisible(true);
              }}
              onDelete={handleDeleteMaterial}
              onShare={handleShareMaterial}
              onView={handleViewMaterial}
              onAnalytics={handleViewAnalytics}
              styles={styles}
              colors={colors}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || parentRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary.main}
              colors={[colors.primary.main]}
            />
          }
        />
      )}

      {/* Modals */}
      <EnhancedMaterialUploadModal
        visible={materialModalVisible}
        onClose={() => {
          setMaterialModalVisible(false);
          setEditingMaterial(null);
        }}
        onSubmit={handleMaterialSubmit}
        editingMaterial={editingMaterial}
        units={units}
        initialUnitId={selectedUnitId}
        styles={styles}
        colors={colors}
      />

      <BulkUploadModal
        visible={bulkModalVisible}
        onClose={() => setBulkModalVisible(false)}
        onUpload={handleBulkUpload}
        styles={styles}
        colors={colors}
      />

      <MaterialViewerModal
        visible={viewerModalVisible}
        onClose={() => {
          setViewerModalVisible(false);
          setSelectedMaterial(null);
        }}
        material={selectedMaterial}
        styles={styles}
        colors={colors}
      />

      <MaterialAnalyticsModal
        visible={analyticsModalVisible}
        onClose={() => {
          setAnalyticsModalVisible(false);
          setSelectedMaterial(null);
        }}
        material={selectedMaterial}
        styles={styles}
        colors={colors}
      />
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  unitPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.borderLight,
    marginBottom: 4,
  },
  unitPickerButtonText: {
    flex: 1,
    marginHorizontal: 8,
    color: C.textPrimary,
    fontSize: 14,
  },
  unitSelectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primarySoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.primaryMain + '40',
  },
  unitSelectorText: {
    flex: 1,
    marginHorizontal: 8,
    color: C.primaryMain,
    fontWeight: '600',
    fontSize: 14,
  },
  unitDropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  unitDropdownContent: {
    backgroundColor: C.surfacePrimary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.5,
    paddingBottom: 24,
  },
  unitDropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  unitDropdownTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
  },
  unitItemGradient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 2,
  },
  unitItemCode: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },
  unitItemName: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  unitItemTextActive: {
    color: '#FFFFFF',
  },
  unitItemSubtextActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  unitEmptyText: {
    textAlign: 'center',
    padding: 24,
    color: C.textSecondary,
    fontSize: 14,
  },
  filterHeader: {
    padding: 16,
    backgroundColor: C.surfacePrimary,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    color: C.textPrimary,
    fontSize: 14,
  },
  filterScroll: {
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surfaceSecondary,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: C.primaryMain,
  },
  filterChipText: {
    color: C.textSecondary,
    fontSize: 13,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sortContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 8,
  },
  sortButtonText: {
    fontSize: 12,
    color: C.textSecondary,
  },
  sortButtonTextActive: {
    color: C.primaryMain,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  bulkButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  bulkButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  bulkButtonText: {
    color: C.infoMain,
    fontSize: 15,
    fontWeight: '600',
  },
  tagsContainer: {
    flexDirection: 'row',
    marginTop: 8,
  },
  tag: {
    backgroundColor: C.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 4,
  },
  tagText: {
    color: C.primaryMain,
    fontSize: 10,
    fontWeight: '500',
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceSecondary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  fileName: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 13,
  },
  fileSize: {
    color: C.textSecondary,
    fontSize: 11,
  },
  progressContainer: {
    marginTop: 16,
  },
  progressBar: {
    height: 8,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: C.successMain,
    borderRadius: 4,
  },
  progressText: {
    color: C.textSecondary,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  selectFilesButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  selectFilesGradient: {
    alignItems: 'center',
    padding: 32,
    borderWidth: 2,
    borderColor: C.primaryMain,
    borderStyle: 'dashed',
    gap: 12,
  },
  selectFilesText: {
    color: C.primaryMain,
    fontSize: 16,
    fontWeight: '500',
  },
  selectedFile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceSecondary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  selectedFileName: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 13,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: C.bg,
  },
  videoPlayer: {
    flex: 1,
  },
  pdfViewer: {
    flex: 1,
  },
  filePreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  linkPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  linkUrl: {
    color: C.infoMain,
    fontSize: 16,
    marginVertical: 16,
    textAlign: 'center',
  },
  textContent: {
    flex: 1,
    padding: 16,
  },
  textContentText: {
    color: C.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  downloadButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 16,
  },
  downloadButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  openLinkButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 16,
  },
  openLinkButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  openLinkButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  demographicsContainer: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  demographicItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  demographicLabel: {
    width: 80,
    fontSize: 13,
    color: C.textSecondary,
  },
  demographicBarContainer: {
    flex: 1,
    height: 20,
    backgroundColor: C.surfaceTertiary,
    borderRadius: 10,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  demographicBar: {
    height: '100%',
    backgroundColor: C.primaryMain,
    borderRadius: 10,
  },
  demographicValue: {
    width: 40,
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'right',
  },
  // Who Viewed section
  noViewersBox: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  noViewersText: {
    fontSize: 13,
    color: C.textSecondary,
  },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  viewerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerAvatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: C.primaryMain,
  },
  viewerName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },
  viewerMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  viewerTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.infoSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  viewerTimeText: {
    fontSize: 12,
    color: C.infoMain,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
  tabContent: {
    flex: 1,
    padding: 16,
  },
  listContent: {
    paddingBottom: 20,
  },
  createButton: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  createButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
  },
  materialCard: {
    backgroundColor: C.surfacePrimary,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  materialHeader: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  materialIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  materialContent: {
    flex: 1,
  },
  materialTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  materialTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  unitChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    overflow: 'hidden',
  },
  unitChipText: {
    color: C.primaryMain,
    fontSize: 10,
    fontWeight: '600',
  },
  materialDescription: {
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 8,
    lineHeight: 18,
  },
  materialMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  materialMetaText: {
    fontSize: 11,
    color: C.textSecondary,
  },
  materialActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  materialActionButton: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  materialActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  materialActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: C.overlayMedium,
    justifyContent: 'flex-end',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surfacePrimary,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: height * 0.9,
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.textPrimary,
  },
  modalBody: {
    flex: 1,
    padding: 20,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    gap: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 6,
  },
  requiredStar: {
    color: C.dangerMain,
  },
  input: {
    backgroundColor: C.surfaceSecondary,
    borderWidth: 1,
    borderColor: C.borderLight,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: C.textPrimary,
    marginBottom: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  typeContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  typeButton: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  typeButtonGradient: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  typeButtonText: {
    fontSize: 13,
    color: C.textSecondary,
  },
  typeButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  filePickerButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  filePickerGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 2,
    borderColor: C.primaryMain,
    borderStyle: 'dashed',
    gap: 12,
  },
  filePickerText: {
    fontSize: 14,
    color: C.textSecondary,
    flex: 1,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: C.surfaceSecondary,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textSecondary,
  },
  createButton: {
    flex: 2,
    borderRadius: 16,
    overflow: 'hidden',
  },
  createButtonGradient: {
    flexDirection: 'row',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  analyticsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 20,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 8,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    color: C.textPrimary,
  },
  metricLabel: {
    fontSize: 12,
    color: C.textSecondary,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 12,
  },
  timelineContainer: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  timelineDate: {
    width: 60,
    fontSize: 12,
    color: C.textSecondary,
  },
  timelineBarContainer: {
    flex: 1,
    height: 20,
    backgroundColor: C.surfaceTertiary,
    borderRadius: 10,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  timelineBar: {
    height: '100%',
    backgroundColor: C.primaryMain,
    borderRadius: 10,
  },
  timelineCount: {
    width: 30,
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'right',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textPrimary,
    marginTop: 20,
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: C.surfaceSecondary,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingText: {
    flex: 1,
    gap: 3,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textPrimary,
  },
  settingDescription: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 16,
  },
  // Context menu
  contextMenu: {
    position: 'absolute',
    top: '50%',
    left: 20,
    right: 20,
    backgroundColor: C.surfacePrimary,
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: C.borderLight,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 12,
  },
  contextMenuItemText: {
    fontSize: 15,
    color: C.textPrimary,
  },
});
