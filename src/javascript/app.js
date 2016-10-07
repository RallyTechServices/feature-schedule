Ext.define("feature-schedule", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    items: [
        {xtype:'container',itemId:'message_box',tpl:'Hello, <tpl>{_refObjectName}</tpl>'},
        {xtype:'container',itemId:'display_box'}
    ],

    integrationHeaders : {
        name : "feature-schedule"
    },

    launch: function() {
        if (!this.isTimeboxScoped()){
            this.showNoScopeMessage();
            return;
        }
        this.fetchPortfolioItemTypes().then({
            success: this.initializeApp,
            failure: this.showErrorNotification,
            scope: this
        });

    },
    initializeApp: function(portfolioTypes){
        this.portfolioItemTypeDefs = Ext.Array.map(portfolioTypes, function(p){ return p.getData();});
        this.onTimeboxScopeChange();
    },
    isTimeboxScoped: function(){
        return this.getContext().getTimeboxScope() && this.getContext().getTimeboxScope().getType() === 'release' || false;
    },
    onTimeboxScopeChange: function(timeboxScope) {
        if (!timeboxScope){
            timeboxScope = this.getContext().getTimeboxScope();
        }
        if(timeboxScope && timeboxScope.getType() === 'release') {
            this.getContext().setTimeboxScope(timeboxScope);
            this.updateView(timeboxScope);
        }
    },
    showAppNotification: function(msg){
        this.removeAll();
        this.add({
            xtype: 'container',
            html: Ext.String.format('<div class="no-data-container"><div class="secondary-message">{0}</div></div>', msg)
        });
    },
    showNoScopeMessage: function(){
        this.showAppNotification('This app is designed for a Release scoped dashboard.  Please update the current dashboard to have an release scope.');
    },
    showErrorNotification: function(msg){
        Rally.ui.notify.Notifier.showError({
            message: msg
        });
    },
    updateView: function(timeboxScope){
        this.logger.log('updateView', timeboxScope);

        this.fetchUserStories(timeboxScope).then({
            success: this.buildFeatureStore,
            failure: this.showErrorNotification,
            scope: this
        });
    },
    getFeatureName: function(){
        return this.getFeatureTypePath().replace('PortfolioItem/','');
    },
    getFeatureTypePath: function(){
        return this.portfolioItemTypeDefs[0].TypePath;
        //return 'PortfolioItem/Feature';
    },
    fetchPortfolioItemTypes: function(){
        return this.fetchWsapiRecords({
            model: 'TypeDefinition',
            fetch: ['TypePath', 'Ordinal','Name'],
            context: {workspace: this.getContext().getWorkspace()._ref},
            filters: [{
                property: 'Parent.Name',
                operator: '=',
                value: 'Portfolio Item'
            },
            {
                property: 'Creatable',
                operator: '=',
                value: 'true'
            }],
            sorters: [{
                property: 'Ordinal',
                direction: 'ASC'
            }]
        });
    },
    fetchUserStories: function(timeboxScope){
        var timeboxRecord = timeboxScope && timeboxScope.getRecord(),
            timeboxData = timeboxRecord && timeboxRecord.getData() || null,
            storyFilters = timeboxScope && timeboxScope.getQueryFilter();

        if (!timeboxData){
            this.showAppNotification("Please select a Release.");
            return;
        }
        var featureFilters = Ext.create('Rally.data.wsapi.Filter',{
            property: this.getFeatureName() + ".Release.Name",
            value: timeboxData.Name
        });
        featureFilters = featureFilters.and({
            property: this.getFeatureName() + ".Release.ReleaseStartDate",
            value: timeboxData.ReleaseStartDate
        });
        featureFilters = featureFilters.and({
            property: this.getFeatureName() + ".Release.ReleaseDate",
            value: timeboxData.ReleaseDate
        });

        var filters = featureFilters.or(storyFilters);

        this.logger.log('fetchUserStories', filters && filters.toString());

        return this.fetchWsapiRecords({
            model: 'HierarchicalRequirement',
            fetch: ['ObjectID','FormattedID',this.getFeatureName(),'Iteration','EndDate'],
            filters: filters,
            limit: 'Infinity'
        });
    },
    getFeatureFilters: function(releaseStories){
        var featureOids = [];
        Ext.Array.each(releaseStories, function(s){
            var oid = s.get('Feature') && s.get('Feature').ObjectID;
            if (!Ext.Array.contains(featureOids, oid)){
                featureOids.push(oid);
            }
        });

        var featureFilters = Ext.Array.map(featureOids, function(f){ return { property: 'ObjectID', value: f }});
        featureFilters = Rally.data.wsapi.Filter.or(featureFilters);
        featureFilters = featureFilters.or(this.getContext().getTimeboxScope().getQueryFilter());
        this.logger.log('getFeatureFilters', featureFilters.toString());

        return featureFilters;
    },
    getModelNames: function(){
        return [this.getFeatureTypePath()];
    },
    updateFeatures: function(store, node, records, operation){
        this.logger.log('updateFeatures', records, operation, this.userStories);

        var featureHash = {},
            featureName = this.getFeatureName();

        Ext.Array.each(this.userStories, function(s){
            if (s.get(featureName) && s.get('Iteration')){
                var endDate = Rally.util.DateTime.fromIsoString(s.get('Iteration').EndDate),
                    featureOid = s.get(featureName).ObjectID;

                if (!featureHash[featureOid]){
                    featureHash[featureOid] = {
                        latestEndDate: endDate
                    }
                }

                if (featureHash[featureOid].latestEndDate < endDate){
                    featureHash[featureOid].latestEndDate = endDate;
                }
            }
        });
        this.logger.log('featureHash', featureHash);
        var milestoneOids = [];
        Ext.Array.each(records, function(r){
           var milestones = r.get('Milestones');
            if (milestones && milestones.Count > 0){
                Ext.Array.each(milestones._tagsNameArray, function(t){
                    if (t._ref){
                        var moid = Number(t._ref.replace('/milestone/',''));
                        if (moid && !Ext.Array.contains(milestoneOids, moid)){
                            milestoneOids.push(moid);
                        }
                    }
                });
            }

            var oid = r.get('ObjectID');
            if (featureHash[oid]){
                r.set('__latestIterationEndDate', featureHash[oid].latestEndDate);
            }
        });

        if (milestoneOids.length > 0){
            var filters = Ext.Array.map(milestoneOids, function(m){ return {
                    property: 'ObjectID',
                    value: m
                };
            });
            filters = Rally.data.wsapi.Filter.or(filters);

            this.fetchWsapiRecords({
                model: 'Milestone',
                fetch: ['ObjectID','FormattedID','TargetDate'],
                filters: filters,
                limit: milestoneOids.length,
                context: {project: null},
                usePostGet: true
            }).then({
                success: function(milestones){
                    var milestoneHash = {};
                    Ext.Array.each(milestones, function(m){
                        milestoneHash[m.get("_ref")] = m.get('TargetDate') ? Rally.util.DateTime.fromIsoString(m.get('TargetDate')) : null;
                    });

                    Ext.Array.each(records, function(f){
                        var featureMilestones = f.get('Milestones');
                        if (featureMilestones && featureMilestones.Count > 0){
                            featureMilestones = featureMilestones._tagsNameArray;
                            var earliestMilestoneDate = null;
                            Ext.Array.each(featureMilestones, function(fm){
                                var mdate = milestoneHash[fm._ref];
                                if (mdate && (!earliestMilestoneDate || earliestMilestoneDate > mdate)){
                                    earliestMilestoneDate = mdate;
                                }
                            });
                            f.set('__earliestMilestoneDate', earliestMilestoneDate);
                        }
                    });
                },
                failure: this.showErrorNotification,
                scope: this
            });
        }
    },
    buildFeatureStore: function(stories){
        this.logger.log('buildFeatureStore', stories);
        if (!stories || stories.length === 0){
            this.showAppNotification("No stories were found for the selected Release.");
            return;
        }
        this.userStories = stories;
        this.removeAll();
        var filters = this.getFeatureFilters(stories);

        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            models: this.getModelNames(),
           // autoLoad: true,
            enableHierarchy: true,
            fetch: ['PlannedEndDate','Milestones','ObjectID','TargetDate'],
            filters: filters
        }).then({
            success: function(store) {
                store.model.addField({name: '__latestIterationEndDate', type: 'auto', defaultValue: null});
                store.model.addField({name: '__earliestMilestoneDate', type: 'auto', defaultValue: null});


                store.on('load', this.updateFeatures, this);
                this.add({
                    xtype: 'rallygridboard',
                    context: this.getContext(),
                    modelNames: this.getModelNames(),
                    toggleState: 'grid',
                    plugins: this.getGridPlugins(),
                    gridConfig: {
                        store: store,
                        columnCfgs: this.getColumnConfigs(),
                        derivedColumns: this.getDerivedColumns()
                    },
                    height: this.getHeight()
                });
            },
            scope: this
        });
    },
    getGridPlugins: function(){
        return [{
            ptype:'rallygridboardaddnew'
        },
        {
            ptype: 'rallygridboardfieldpicker',
            headerPosition: 'left',
            modelNames: this.getModelNames(),
            stateful: true,
            margin: '3 3 3 25',
            stateId: this.getContext().getScopedStateId('feature-schedule-columns')
        },{
            ptype: 'rallygridboardinlinefiltercontrol',
            inlineFilterButtonConfig: {
                stateful: true,
                stateId: this.getContext().getScopedStateId('feature-schedule-filters'),
                modelNames: this.getModelNames(),
                margin: 3,
                inlineFilterPanelConfig: {
                    quickFilterPanelConfig: {
                        defaultFields: [
                            'ArtifactSearch',
                            'Owner',
                            'ModelType'
                        ]
                    }
                }
            }
        }, {
            ptype: 'rallygridboardactionsmenu',
            menuItems: [
                {
                    text: 'Export...',
                    handler: function() {
                        window.location = Rally.ui.gridboard.Export.buildCsvExportUrl(
                            this.down('rallygridboard').getGridOrBoard());
                    },
                    scope: this
                }
            ],
            buttonConfig: {
                margin: 3,
                iconCls: 'icon-export'
            }
        }];
    },
    getColumnConfigs: function(){
        return [{
            dataIndex: 'Name',
            text: 'Name'
        },{
            dataIndex: 'PlannedEndDate',
            text: 'Planned End Date'
        },{
            dataIndex:'Milestones',
            text: 'Milestones'
        }].concat(this.getDerivedColumns());
    },
    getDerivedColumns: function(){
        return [{
            dataIndex: '__latestIterationEndDate',
            xtype: 'templatecolumn',
            text: 'Latest Iteration End Date',
            tpl: '<div style="text-align:right;">{__latestIterationEndDate}</div>',
        },{

            dataIndex: '__earliestMilestoneDate',
            xtype: 'templatecolumn',
            text: 'Earliest Milestone Date',
            tpl: '<div style="text-align:right;">{__earliestMilestoneDate}</div>',
        }]
    },
    fetchWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        Ext.create('Rally.data.wsapi.Store',config).load({
            callback: function(records, operation){
                if (operation.wasSuccessful()){
                    deferred.resolve(records);
                } else {
                    deferred.reject(Ext.String.format('Failed to fetch {0} records: {1}',config.model ,operation && operation.error && operation.error.errors.join(',')));
                }
            }
        });
        return deferred;
    },
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});
