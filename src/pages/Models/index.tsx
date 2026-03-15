import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Play, Square, Download, Trash2, Search, Cpu, CheckCircle, AlertCircle, Star, Cloud, BarChart3 } from 'lucide-react';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { FeedbackState } from '@/components/common/FeedbackState';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
  type UsageGroupBy,
  type UsageHistoryEntry,
  type UsageWindow,
} from './usage-history';

type TabType = 'local' | 'cloud' | 'usage';

interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  size: number;
  url?: string;
  downloads?: number;
}

interface EngineStatus {
  running: boolean;
  modelId?: string;
  modelName?: string;
  port?: number;
  engineAvailable: boolean;
}

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const [activeTab, setActiveTab] = useState<TabType>('local');

  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ running: false, engineAvailable: false });
  const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
  const [recommendedModels, setRecommendedModels] = useState<ModelInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [loading, setLoading] = useState(true);

  const [usageHistory, setUsageHistory] = useState<UsageHistoryEntry[]>([]);
  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);
  const usageFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageFetchGenerationRef = useRef(0);

  const usageFetchMaxAttempts = window.electron.platform === 'win32' ? 10 : 6;

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  useEffect(() => {
    if (activeTab === 'local') {
      loadLocalData();
    }
  }, [activeTab]);

  useEffect(() => {
    if (usageFetchTimerRef.current) {
      clearTimeout(usageFetchTimerRef.current);
      usageFetchTimerRef.current = null;
    }

    if (!isGatewayRunning) return;

    const generation = usageFetchGenerationRef.current + 1;
    usageFetchGenerationRef.current = generation;
    const restartMarker = `${gatewayStatus.pid ?? 'na'}:${gatewayStatus.connectedAt ?? 'na'}`;
    trackUiEvent('models.token_usage_fetch_started', { generation, restartMarker });

    const fetchUsageHistoryWithRetry = async (attempt: number) => {
      trackUiEvent('models.token_usage_fetch_attempt', { generation, attempt, restartMarker });
      try {
        const entries = await hostApiFetch<UsageHistoryEntry[]>('/api/usage/recent-token-history');
        if (usageFetchGenerationRef.current !== generation) return;

        const normalized = Array.isArray(entries) ? entries : [];
        setUsageHistory(normalized);
        setUsagePage(1);
        trackUiEvent('models.token_usage_fetch_succeeded', { generation, attempt, records: normalized.length, restartMarker });

        if (normalized.length === 0 && attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', { generation, attempt, reason: 'empty', restartMarker });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, 1500);
        } else if (normalized.length === 0) {
          trackUiEvent('models.token_usage_fetch_exhausted', { generation, attempt, reason: 'empty', restartMarker });
        }
      } catch (error) {
        trackUiEvent('models.token_usage_fetch_failed', { generation, attempt, restartMarker, error: String(error) });
        if (attempt < usageFetchMaxAttempts) {
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, 1500);
        }
      }
    };

    void fetchUsageHistoryWithRetry(1);

    return () => {
      if (usageFetchTimerRef.current) {
        clearTimeout(usageFetchTimerRef.current);
      }
    };
  }, [isGatewayRunning, gatewayStatus.pid, gatewayStatus.connectedAt]);

  const loadLocalData = async () => {
    setLoading(true);
    try {
      await hostApiFetch('/api/inference/initialize', { method: 'POST' });

      const [statusRes, localRes, recommendedRes] = await Promise.all([
        hostApiFetch('/api/inference/status') as Promise<{ success: boolean; data: EngineStatus }>,
        hostApiFetch('/api/inference/models/local') as Promise<{ success: boolean; data: ModelInfo[] }>,
        hostApiFetch('/api/inference/models/recommended') as Promise<{ success: boolean; data: ModelInfo[] }>
      ]);

      setEngineStatus(statusRes.data);
      setLocalModels(localRes.data || []);
      setRecommendedModels(recommendedRes.data || []);
    } catch (error) {
      console.error('Failed to load local data:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchModels = async () => {
    if (!searchQuery.trim()) return;

    console.log('Searching for:', searchQuery);
    setSearching(true);
    try {
      const results = await hostApiFetch(`/api/inference/models/search?q=${encodeURIComponent(searchQuery)}`) as { success: boolean; data: ModelInfo[] };
      console.log('Search results:', results);
      setSearchResults(results.data || []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const downloadModel = async (modelId: string, modelName: string) => {
    setDownloading(modelId);
    setDownloadProgress(0);

    const progressInterval = setInterval(() => {
      setDownloadProgress(prev => Math.min(prev + 5, 90));
    }, 500);

    try {
      await hostApiFetch(`/api/inference/models/download/${modelId}`, { method: 'POST' });
      clearInterval(progressInterval);
      setDownloadProgress(100);
      await loadLocalData();
    } catch (error) {
      clearInterval(progressInterval);
      console.error('Download failed:', error);
    } finally {
      setTimeout(() => {
        setDownloading(null);
        setDownloadProgress(0);
      }, 1000);
    }
  };

  const deleteModel = async (modelId: string) => {
    try {
      await hostApiFetch(`/api/inference/models/${modelId}`, { method: 'DELETE' });
      await loadLocalData();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const startEngine = async (modelId: string) => {
    try {
      await hostApiFetch('/api/inference/start', { method: 'POST', body: JSON.stringify({ modelId }) });
      await loadLocalData();
    } catch (error) {
      console.error('Start failed:', error);
    }
  };

  const stopEngine = async () => {
    try {
      await hostApiFetch('/api/inference/stop', { method: 'POST' });
      await loadLocalData();
    } catch (error) {
      console.error('Stop failed:', error);
    }
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `~${gb.toFixed(1)}GB`;
    const mb = bytes / (1024 * 1024);
    return `~${mb.toFixed(0)}MB`;
  };

  const filteredUsageHistory = filterUsageHistoryByWindow(usageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 10;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && usageHistory.length === 0;
  const visibleUsageHistory = usageHistory;

  const formatTokenCount = (count: number) => {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(count);
  };

  const formatUsageTimestamp = (timestamp: number) => {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp);
  };

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('dashboard:models.title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">
              {t('dashboard:models.subtitle')}
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-8 shrink-0">
          <Button
            variant={activeTab === 'local' ? 'secondary' : 'ghost'}
            onClick={() => setActiveTab('local')}
            className={activeTab === 'local' ? "bg-black/10 dark:bg-white/10" : ""}
          >
            <Cpu className="h-4 w-4 mr-2" />
            {t('models.tabs.local', '本地推理')}
          </Button>
          <Button
            variant={activeTab === 'cloud' ? 'secondary' : 'ghost'}
            onClick={() => setActiveTab('cloud')}
            className={activeTab === 'cloud' ? "bg-black/10 dark:bg-white/10" : ""}
          >
            <Cloud className="h-4 w-4 mr-2" />
            {t('models.tabs.cloud', '云端API')}
          </Button>
          <Button
            variant={activeTab === 'usage' ? 'secondary' : 'ghost'}
            onClick={() => setActiveTab('usage')}
            className={activeTab === 'usage' ? "bg-black/10 dark:bg-white/10" : ""}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            {t('models.tabs.usage', 'Token用量')}
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">

          {/* Local Inference Tab */}
          {activeTab === 'local' && (
            <div className="space-y-6">
              {loading ? (
                <div className="text-center py-12">{t('common.loading', 'Loading...')}</div>
              ) : (
                <>
                  {/* Status Card */}
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-2">
                            <Cpu className="h-5 w-5" />
                            <span>{t('models.local.engine', '引擎')}:</span>
                            {engineStatus.engineAvailable ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className={engineStatus.engineAvailable ? 'text-green-600' : 'text-red-600'}>
                              {engineStatus.engineAvailable ? t('models.local.installed', '已安装') : t('models.local.notInstalled', '未安装')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>{t('models.local.model', '模型')}:</span>
                            <span>{localModels.length > 0 ? localModels[0].name : t('models.local.noModel', '未下载')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span>{t('models.local.status', '状态')}:</span>
                            <span className={engineStatus.running ? 'text-green-600' : 'text-gray-500'}>
                              {engineStatus.running ? `▶ ${t('models.local.running', '运行中')} (${engineStatus.port})` : '⏹ ' + t('models.local.stopped', '已停止')}
                            </span>
                          </div>
                        </div>
                        <Button
                          className={engineStatus.running ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}
                          onClick={() => engineStatus.running ? stopEngine() : startEngine(localModels[0]?.id || '')}
                          disabled={!engineStatus.engineAvailable || (localModels.length === 0 && !engineStatus.running)}
                        >
                          {engineStatus.running ? (
                            <>
                              <Square className="h-4 w-4 mr-2" />
                              {t('models.local.stop', '停止')}
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              {t('models.local.start', '一键启动')}
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Download Progress */}
                  {downloading && (
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span>{t('models.local.downloading', '下载中')}: {downloading}</span>
                          <span>{downloadProgress}%</span>
                        </div>
                        <Progress value={downloadProgress} />
                      </CardContent>
                    </Card>
                  )}

                  {/* Recommended Models */}
                  <div>
                    <h2 className="text-xl font-medium mb-4">{t('models.local.recommended', '⭐ 推荐模型')}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {recommendedModels.map(model => (
                        <Card key={model.id}>
                          <CardContent className="p-4 flex items-center justify-between">
                            <div>
                              <div className="font-medium flex items-center gap-2">
                                {model.name}
                                {model.id.includes('35B') && <Star className="h-4 w-4 text-yellow-500" />}
                              </div>
                              <div className="text-sm text-gray-500">{model.description}</div>
                            </div>
                            <div className="flex gap-2">
                              {localModels.some(m => m.id === model.id) ? (
                                <Button size="sm" variant="secondary" disabled>
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  {t('models.local.downloaded', '已下载')}
                                </Button>
                              ) : (
                                <Button size="sm" onClick={() => downloadModel(model.id, model.name)} disabled={!!downloading}>
                                  <Download className="h-4 w-4 mr-1" />
                                  {t('models.local.download', '下载')}
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>

                  {/* Search */}
                  <div>
                    <h2 className="text-xl font-medium mb-4">{t('models.local.search', '🔍 搜索 HuggingFace')}</h2>
                    <div className="flex gap-2 mb-4">
                      <Input
                        placeholder={t('models.local.searchPlaceholder', '输入模型名称...')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && searchModels()}
                        className="flex-1 h-10 rounded-xl bg-white dark:bg-white/10 border border-input"
                      />
                      <Button onClick={searchModels} disabled={searching}>
                        <Search className="h-4 w-4 mr-2" />
                        {searching ? t('models.local.searching', '搜索中...') : t('models.local.search', '搜索')}
                      </Button>
                    </div>

                    {searchResults.length > 0 && (
                      <div className="space-y-2">
                        {searchResults.map(model => (
                          <Card key={model.id}>
                            <CardContent className="p-4 flex items-center justify-between">
                              <div>
                                <div className="font-medium">{model.name}</div>
                                <div className="text-sm text-gray-500">{model.description}</div>
                              </div>
                              <Button size="sm" onClick={() => downloadModel(model.id, model.name)} disabled={!!downloading}>
                                <Download className="h-4 w-4 mr-1" />
                                {t('models.local.download', '下载')}
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Local Models */}
                  {localModels.length > 0 && (
                    <div>
                      <h2 className="text-xl font-medium mb-4">{t('models.local.localModels', '📁 本地模型')} ({localModels.length})</h2>
                      <div className="space-y-2">
                        {localModels.map(model => (
                          <Card key={model.id}>
                            <CardContent className="p-4 flex items-center justify-between">
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {model.name}
                                  {engineStatus.modelId === model.id && engineStatus.running && (
                                    <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded">
                                      {t('models.local.running', '运行中')}
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-gray-500">{formatSize(model.size)}</div>
                              </div>
                              <div className="flex gap-2">
                                {engineStatus.modelId === model.id && engineStatus.running ? (
                                  <Button size="sm" variant="destructive" onClick={stopEngine}>
                                    <Square className="h-4 w-4 mr-1" />
                                    {t('models.local.stop', '停止')}
                                  </Button>
                                ) : (
                                  <Button size="sm" onClick={() => startEngine(model.id)} disabled={!engineStatus.engineAvailable}>
                                    <Play className="h-4 w-4 mr-1" />
                                    {t('models.local.start', '启动')}
                                  </Button>
                                )}
                                <Button size="sm" variant="destructive" onClick={() => deleteModel(model.id)}>
                                  <Trash2 className="h-4 w-4 mr-1" />
                                  {t('models.local.delete', '删除')}
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Cloud API Tab */}
          {activeTab === 'cloud' && (
            <ProvidersSettings />
          )}

          {/* Token Usage Tab */}
          {activeTab === 'usage' && (
            <div className="space-y-6">
              <h2 className="text-3xl font-serif text-foreground font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
                {t('dashboard:recentTokenHistory.title', 'Token Usage History')}
              </h2>
              <div>
                {usageLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                    <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
                  </div>
                ) : visibleUsageHistory.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                    <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
                  </div>
                ) : filteredUsageHistory.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
                    <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.emptyForWindow')} />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
                          <Button
                            variant={usageGroupBy === 'model' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => { setUsageGroupBy('model'); setUsagePage(1); }}
                            className={usageGroupBy === 'model' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                          >
                            {t('dashboard:recentTokenHistory.groupByModel')}
                          </Button>
                          <Button
                            variant={usageGroupBy === 'day' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => { setUsageGroupBy('day'); setUsagePage(1); }}
                            className={usageGroupBy === 'day' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                          >
                            {t('dashboard:recentTokenHistory.groupByTime')}
                          </Button>
                        </div>
                        <div className="flex rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
                          <Button
                            variant={usageWindow === '7d' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => { setUsageWindow('7d'); setUsagePage(1); }}
                            className={usageWindow === '7d' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                          >
                            {t('dashboard:recentTokenHistory.last7Days')}
                          </Button>
                          <Button
                            variant={usageWindow === '30d' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => { setUsageWindow('30d'); setUsagePage(1); }}
                            className={usageWindow === '30d' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                          >
                            {t('dashboard:recentTokenHistory.last30Days')}
                          </Button>
                          <Button
                            variant={usageWindow === 'all' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => { setUsageWindow('all'); setUsagePage(1); }}
                            className={usageWindow === 'all' ? "rounded-lg bg-black/5 dark:bg-white/10 text-foreground" : "rounded-lg text-muted-foreground"}
                          >
                            {t('dashboard:recentTokenHistory.allTime')}
                          </Button>
                        </div>
                      </div>
                      <p className="text-[13px] font-medium text-muted-foreground">
                        {t('dashboard:recentTokenHistory.showingLast', { count: filteredUsageHistory.length })}
                      </p>
                    </div>

                    <div className="space-y-3 pt-2">
                      {pagedUsageHistory.map((entry) => (
                        <div
                          key={`${entry.sessionId}-${entry.timestamp}`}
                          className="rounded-2xl bg-transparent border border-black/10 dark:border-white/10 p-5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-[15px] text-foreground truncate">
                                {entry.model || t('dashboard:recentTokenHistory.unknownModel')}
                              </p>
                              <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                                {[entry.provider, entry.agentId, entry.sessionId].filter(Boolean).join(' • ')}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-bold text-[15px]">{formatTokenCount(entry.totalTokens)}</p>
                              <p className="text-[12px] text-muted-foreground mt-0.5">
                                {formatUsageTimestamp(entry.timestamp)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] font-medium text-muted-foreground">
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-sky-500"></div>{t('dashboard:recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}</span>
                            <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-violet-500"></div>{t('dashboard:recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}</span>
                            {entry.cacheReadTokens > 0 && (
                              <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500"></div>{t('dashboard:recentTokenHistory.cacheRead', { value: formatTokenCount(entry.cacheReadTokens) })}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {usageTotalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 pt-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={usagePage <= 1}
                          onClick={() => setUsagePage(p => p - 1)}
                        >
                          {t('common.previous', 'Previous')}
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          {usagePage} / {usageTotalPages}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={usagePage >= usageTotalPages}
                          onClick={() => setUsagePage(p => p + 1)}
                        >
                          {t('common.next', 'Next')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default Models;
