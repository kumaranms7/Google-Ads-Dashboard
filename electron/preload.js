'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings & credentials
  getSettings:    ()       => ipcRenderer.invoke('settings:get'),
  saveSettings:   (data)   => ipcRenderer.invoke('settings:save', data),

  // Preferences (hidePaused, etc.)
  getPrefs:       ()       => ipcRenderer.invoke('prefs:get'),
  setPrefs:       (data)   => ipcRenderer.invoke('prefs:set', data),

  // Accounts & dashboard
  fetchAccounts:  ()       => ipcRenderer.invoke('accounts:fetch'),
  fetchDashboard: (params) => ipcRenderer.invoke('dashboard:fetch', params),
  refreshData:    (params) => ipcRenderer.invoke('data:refresh',    params),

  // Per-account Business Profile (advertiser context for AI asset generation)
  accountGetProfile:    (params) => ipcRenderer.invoke('account:getProfile',    params),
  accountSaveProfile:   (params) => ipcRenderer.invoke('account:saveProfile',   params),
  accountDeleteProfile: (params) => ipcRenderer.invoke('account:deleteProfile', params),
  accountDetectProfile: (params) => ipcRenderer.invoke('account:detectProfile', params),

  // Reports
  fetchReport:    (params) => ipcRenderer.invoke('reports:fetch',   params),

  // Call leads
  fetchCallLeads: (params) => ipcRenderer.invoke('calls:fetch',     params),

  // Wasted spend keywords
  fetchWastedSpend: (params) => ipcRenderer.invoke('wasted:fetch',  params),

  // Top converting ads
  fetchTopAds:    (params) => ipcRenderer.invoke('ads:fetch',       params),
  adsUnderPerformerRec: (params) => ipcRenderer.invoke('ads:underPerformerRec', params),

  // Negative keywords & search terms
  fetchNegatives: (params) => ipcRenderer.invoke('negatives:fetch', params),
  fetchExistingNegatives: (params) => ipcRenderer.invoke('negatives:fetchExisting', params),

  // Keywords with call conversion counts
  fetchKeywords:     (params) => ipcRenderer.invoke('keywords:fetch', params),

  // Keyword planner ideas
  fetchKeywordIdeas:  (params) => ipcRenderer.invoke('keywords:ideas',           params),
  cpcOptimize:        (params) => ipcRenderer.invoke('keywords:cpcOptimize',    params),
  negativeOptimize:        (params) => ipcRenderer.invoke('keywords:negativeOptimize',     params),
  negativeRowRecommend:    (params) => ipcRenderer.invoke('keywords:negativeRowRecommend', params),

  // Account audit
  fetchAudit:          (params) => ipcRenderer.invoke('audit:fetch',         params),
  auditAiRecommend:    (params) => ipcRenderer.invoke('audit:ai-recommend',  params),
  auditAccountStructure: (params) => ipcRenderer.invoke('audit:accountStructure', params),
  auditKeywordConflicts: (params) => ipcRenderer.invoke('audit:keywordConflicts', params),
  auditUpdateNegativeKeywordStatus: (params) => ipcRenderer.invoke('audit:updateNegativeKeywordStatus', params),
  auditAssetAudit:        (params) => ipcRenderer.invoke('audit:assetAudit',        params),

  // PDF export (Electron printToPDF)
  exportPDF:      (opts)   => ipcRenderer.invoke('pdf:export',      opts),
  exportHTML:     (opts)   => ipcRenderer.invoke('html:export',     opts),

  // Search Terms
  fetchSearchTerms:     (params) => ipcRenderer.invoke('searchterms:fetch',  params),

  // Summary AI review
  aiAccountReview:      (params) => ipcRenderer.invoke('summary:aiReview',      params),

  // AI Chat Assistant
  chatAsk:              (params) => ipcRenderer.invoke('chat:ask',              params),

  // Keyword analysis for Summary tab
  fetchKeywordAnalysis:     (params) => ipcRenderer.invoke('summary:keywordAnalysis',    params),

  // Search term analysis for Summary tab
  fetchSearchTermAnalysis:      (params) => ipcRenderer.invoke('summary:searchTermAnalysis',      params),

  // Ad performance analysis for Summary tab
  fetchAdPerformanceAnalysis:   (params) => ipcRenderer.invoke('summary:adPerformanceAnalysis',   params),

  // RSA Builder
  rsaFetchCampaigns:        (params) => ipcRenderer.invoke('rsa:fetchCampaigns',         params),
  rsaFetchAdGroups:         (params) => ipcRenderer.invoke('rsa:fetchAdGroups',          params),
  rsaFetchBuilderData:      (params) => ipcRenderer.invoke('rsa:fetchBuilderData',       params),
  rsaFetchReportData:       (params) => ipcRenderer.invoke('rsa:fetchReportData',        params),
  rsaAnalyzeLandingPage:    (params) => ipcRenderer.invoke('rsa:analyzeLandingPage',     params),
  rsaGenerateHeadlineRecs:  (params) => ipcRenderer.invoke('rsa:generateHeadlineRecs',   params),
  rsaGenerateAssets:            (params) => ipcRenderer.invoke('rsa:generateRSAAssets',        params),
  rsaRecommendUrlAssets:        (params) => ipcRenderer.invoke('rsa:recommendUrlAssets',       params),
  rsaAnalyzeLandingPageRelevance: (params) => ipcRenderer.invoke('rsa:analyzeLandingPageRelevance', params),
  rsaRegenerateSingleAsset:     (params) => ipcRenderer.invoke('rsa:regenerateSingleAsset',    params),
  rsaRefreshAllDescriptions:    (params) => ipcRenderer.invoke('rsa:refreshAllDescriptions',   params),
  rsaClassifyHeadlineTypes:     (params) => ipcRenderer.invoke('rsa:classifyHeadlineTypes',    params),
  rsaSuggestKeywords:           (params) => ipcRenderer.invoke('rsa:suggestKeywords',          params),

  // Publish keyword to Google Ads
  publishKeyword: (params) => ipcRenderer.invoke('keywords:publish', params),

  // Negative keyword publishing
  fetchNegativeKeywordLists:    (params) => ipcRenderer.invoke('negatives:fetchLists',         params),
  publishNegativesToCampaign:   (params) => ipcRenderer.invoke('negatives:publishToCampaign',  params),
  publishNegativesToAdGroup:    (params) => ipcRenderer.invoke('negatives:publishToAdGroup',   params),
  fetchNegativeListsForCampaign: (params) => ipcRenderer.invoke('negatives:fetchListsForCampaign', params),
  fetchCampaignLevelNegatives:   (params) => ipcRenderer.invoke('negatives:fetchCampaignLevel',    params),
  fetchAdGroupLevelNegatives:    (params) => ipcRenderer.invoke('negatives:fetchAdGroupLevel',      params),
  removeCampaignLevelNegatives:  (params) => ipcRenderer.invoke('negatives:removeCampaignLevel',   params),
  removeAdGroupLevelNegatives:   (params) => ipcRenderer.invoke('negatives:removeAdGroupLevel',    params),
  removeSharedListNegatives:     (params) => ipcRenderer.invoke('negatives:removeSharedList',      params),

  // RSA Apply to Google Ads
  rsaApply:          (params) => ipcRenderer.invoke('rsa:apply',          params),
  rsaGetChangelog:   ()       => ipcRenderer.invoke('rsa:getChangelog'),
  rsaRollback:       (params) => ipcRenderer.invoke('rsa:rollback',       params),
  rsaUpdateContents: (params) => ipcRenderer.invoke('rsa:updateContents', params),
  rsaUpdateExistingAd: (params) => ipcRenderer.invoke('rsa:updateExistingAd', params),
  rsaRollbackEditAd:   (params) => ipcRenderer.invoke('rsa:rollbackEditAd',   params),
  rsaEnableAd:            (params) => ipcRenderer.invoke('rsa:enableAd',            params),
  rsaGetAdGroupSitelinks:        (params) => ipcRenderer.invoke('rsa:getAdGroupSitelinks',        params),
  rsaPublishSingleSitelink:      (params) => ipcRenderer.invoke('rsa:publishSingleSitelink',      params),
  rsaEditSitelinkAsset:          (params) => ipcRenderer.invoke('rsa:editSitelinkAsset',          params),
  rsaPublishSitelinkToAccount:   (params) => ipcRenderer.invoke('rsa:publishSitelinkToAccount',   params),
  rsaPublishSitelinkToCampaign:  (params) => ipcRenderer.invoke('rsa:publishSitelinkToCampaign',  params),
  rsaGetAccountSitelinks:        (params) => ipcRenderer.invoke('rsa:getAccountSitelinks',        params),
  rsaGetCampaignSitelinks:       (params) => ipcRenderer.invoke('rsa:getCampaignSitelinks',       params),
  rsaGenerateSitelinksAI:        (params) => ipcRenderer.invoke('rsa:generateSitelinksAI',        params),
  rsaRegenerateSingleSitelink:   (params) => ipcRenderer.invoke('rsa:regenerateSingleSitelink',   params),
  rsaPauseAd:        (params) => ipcRenderer.invoke('rsa:pauseAd',        params),
  rsaRemoveAd:       (params) => ipcRenderer.invoke('rsa:removeAd',       params),

  // Headline / Description Assets (Performance Max / Demand Gen Asset Groups)
  rsaFetchHeadlineAssets:        (params) => ipcRenderer.invoke('rsa:fetchHeadlineAssets',        params),
  rsaFetchDescriptionAssets:     (params) => ipcRenderer.invoke('rsa:fetchDescriptionAssets',     params),
  rsaAddHeadlineAsset:           (params) => ipcRenderer.invoke('rsa:addHeadlineAsset',           params),
  rsaAddDescriptionAsset:        (params) => ipcRenderer.invoke('rsa:addDescriptionAsset',        params),
  rsaGenerateHeadlinesAI:        (params) => ipcRenderer.invoke('rsa:generateHeadlinesAI',        params),
  rsaGenerateDescriptionsAI:     (params) => ipcRenderer.invoke('rsa:generateDescriptionsAI',     params),
  rsaGenerateLongHeadlinesAI:    (params) => ipcRenderer.invoke('rsa:generateLongHeadlinesAI',    params),

  // Callout Assets
  rsaFetchCalloutAssets:         (params) => ipcRenderer.invoke('rsa:fetchCalloutAssets',         params),
  rsaPublishCallout:             (params) => ipcRenderer.invoke('rsa:publishCallout',             params),
  rsaEditCalloutAsset:           (params) => ipcRenderer.invoke('rsa:editCalloutAsset',           params),
  rsaGenerateCalloutsAI:         (params) => ipcRenderer.invoke('rsa:generateCalloutsAI',          params),
  rsaRegenerateSingleCallout:    (params) => ipcRenderer.invoke('rsa:regenerateSingleCallout',    params),

  // Call Assets
  rsaFetchCallAssets:            (params) => ipcRenderer.invoke('rsa:fetchCallAssets',             params),
  rsaPublishCallAsset:           (params) => ipcRenderer.invoke('rsa:publishCallAsset',             params),
  rsaEditCallAsset:              (params) => ipcRenderer.invoke('rsa:editCallAsset',                params),
  rsaFetchConversionActions:     (params) => ipcRenderer.invoke('rsa:fetchConversionActions',       params),

  // Asset Link management (Pause/Remove) — shared across every asset type
  rsaUpdateAssetLinkStatus:      (params) => ipcRenderer.invoke('rsa:updateAssetLinkStatus',         params),

  // Structured Snippet Assets
  rsaFetchStructuredSnippetAssets: (params) => ipcRenderer.invoke('rsa:fetchStructuredSnippetAssets', params),
  rsaPublishStructuredSnippet:     (params) => ipcRenderer.invoke('rsa:publishStructuredSnippet',     params),
  rsaEditStructuredSnippetAsset:   (params) => ipcRenderer.invoke('rsa:editStructuredSnippetAsset',   params),
  rsaGenerateStructuredSnippetAI:  (params) => ipcRenderer.invoke('rsa:generateStructuredSnippetAI',  params),
  rsaRegenerateSingleSnippetValue: (params) => ipcRenderer.invoke('rsa:regenerateSingleSnippetValue', params),

  // Campaign Manager
  campaignList:            (params) => ipcRenderer.invoke('campaign:list',            params),
  campaignGet:             (params) => ipcRenderer.invoke('campaign:get',             params),
  campaignGetChangelog:    (params) => ipcRenderer.invoke('campaign:getChangelog', params),
  campaignCreateSearch:    (params) => ipcRenderer.invoke('campaign:createSearch',    params),
  campaignCreateDisplay:   (params) => ipcRenderer.invoke('campaign:createDisplay',   params),
  campaignCreatePerformanceMax: (params) => ipcRenderer.invoke('campaign:createPerformanceMax', params),
  campaignCreateShopping:  (params) => ipcRenderer.invoke('campaign:createShopping',  params),
  campaignCreateVideo:     (params) => ipcRenderer.invoke('campaign:createVideo',     params),
  campaignUpdateName:      (params) => ipcRenderer.invoke('campaign:updateName',      params),
  campaignUpdateStatus:    (params) => ipcRenderer.invoke('campaign:updateStatus',    params),
  campaignUpdateBudget:    (params) => ipcRenderer.invoke('campaign:updateBudget',    params),
  campaignUpdateBidding:   (params) => ipcRenderer.invoke('campaign:updateBidding',   params),
  campaignUpdateEndDate:   (params) => ipcRenderer.invoke('campaign:updateEndDate',   params),
  campaignUpdateTargeting: (params) => ipcRenderer.invoke('campaign:updateTargeting', params),
  campaignRollback:        (params) => ipcRenderer.invoke('campaign:rollback',        params),
  campaignAiRecommend:      (params) => ipcRenderer.invoke('campaign:aiRecommend',      params),
  campaignAiRecommendAdGroups: (params) => ipcRenderer.invoke('campaign:aiRecommendAdGroups', params),
  campaignSearchGeoTargets: (params) => ipcRenderer.invoke('campaign:searchGeoTargets', params),
  campaignListLanguages:    (params) => ipcRenderer.invoke('campaign:listLanguages',    params),

  // Ad Group Manager
  adGroupList:           (params) => ipcRenderer.invoke('adGroup:list',           params),
  adGroupCreate:         (params) => ipcRenderer.invoke('adGroup:create',         params),
  adGroupListKeywords:   (params) => ipcRenderer.invoke('adGroup:listKeywords',   params),
  adGroupAiRecommendKeywords: (params) => ipcRenderer.invoke('adGroup:aiRecommendKeywords', params),
  adGroupUpdateKeywords: (params) => ipcRenderer.invoke('adGroup:updateKeywords', params),
  adGroupUpdateName:     (params) => ipcRenderer.invoke('adGroup:updateName',     params),
  adGroupUpdateStatus:   (params) => ipcRenderer.invoke('adGroup:updateStatus',   params),
  adGroupUpdateBid:      (params) => ipcRenderer.invoke('adGroup:updateBid',      params),
  adGroupGetChangelog:   (params) => ipcRenderer.invoke('adGroup:getChangelog',   params),
  adGroupRollback:       (params) => ipcRenderer.invoke('adGroup:rollback',       params),

  // Keywords Manager
  keywordManagerList:              (params) => ipcRenderer.invoke('keywordManager:list',              params),
  keywordManagerListSearchTerms:   (params) => ipcRenderer.invoke('keywordManager:listSearchTerms',   params),
  keywordManagerUpdateKeyword:     (params) => ipcRenderer.invoke('keywordManager:updateKeyword',     params),
  keywordManagerBulkUpdateKeywords:(params) => ipcRenderer.invoke('keywordManager:bulkUpdateKeywords',params),
  keywordManagerAddKeywords:       (params) => ipcRenderer.invoke('keywordManager:addKeywords',       params),
  keywordManagerAiRecommendForKeyword:  (params) => ipcRenderer.invoke('keywordManager:aiRecommendForKeyword',  params),
  keywordManagerAiRecommendNewKeywords: (params) => ipcRenderer.invoke('keywordManager:aiRecommendNewKeywords', params),
  keywordManagerAiRecommendNegativeKeywords: (params) => ipcRenderer.invoke('keywordManager:aiRecommendNegativeKeywords', params),
  keywordManagerAiAnalyzeQualityScore: (params) => ipcRenderer.invoke('keywordManager:aiAnalyzeQualityScore', params),

  // Asset Groups (Performance Max)
  assetGroupList:          (params) => ipcRenderer.invoke('assetGroup:list',          params),
  assetGroupGetDetail:     (params) => ipcRenderer.invoke('assetGroup:getDetail',     params),
  assetGroupCreate:        (params) => ipcRenderer.invoke('assetGroup:create',        params),
  assetGroupUpdateName:    (params) => ipcRenderer.invoke('assetGroup:updateName',    params),
  assetGroupUpdateStatus:  (params) => ipcRenderer.invoke('assetGroup:updateStatus',  params),
  assetGroupUpdateContent: (params) => ipcRenderer.invoke('assetGroup:updateContent', params),
  assetGroupGetChangelog:  (params) => ipcRenderer.invoke('assetGroup:getChangelog',  params),
  assetGroupRollback:      (params) => ipcRenderer.invoke('assetGroup:rollback',      params),
})
