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

    flagTooltips: {
        missing: "At least one story is missing an iteration date or the planned end date is missing.",
        late: "Latest iteration date is after the planned end date for the feature."
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
        this.logger.log('timeboxScope', timeboxScope && timeboxScope.getRecord() && timeboxScope.getRecord().getData());
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
    exportCurrentPage: function(){
        var grid = this.down('rallygridboard') && this.down('rallygridboard').getGridOrBoard();
        if (!grid){
            this.showErrorNotification("No data to export");
            return;
        }

        var store = grid.getStore(),
            columns = [{dataIndex: 'FormattedID', text: 'FormattedID'}];

        columns = columns.concat(grid.getColumnCfgs());

        var root = store.getRootNode(),
            csv = [],
            headers = [],
            flagTooltips = this.flagTooltips;

        Ext.Array.each(columns, function(c){

            if (c.dataIndex ){
                headers.push(c.text || c.dataIndex);
            }
        });
        csv.push(headers.join(','));

        Ext.Array.each(root.childNodes, function(r){
            var row = [];
            Ext.Array.each(columns, function(c){
                if (c.dataIndex){

                    var val = r.get(c.dataIndex);
                    if (Ext.isObject(val)){
                        if (val._tagsNameArray){
                            var newVal = [];
                            Ext.Array.each(val._tagsNameArray, function(t){
                                newVal.push(t.Name);
                            });
                            val = newVal.join(',');
                        } else {
                            val = val._refObjectName;
                        }
                    }
                    if (c.dataIndex === '__isLate'){
                        if (val === 1){
                            val = flagTooltips.missing;
                        }
                        if (val === 2){
                            val = flagTooltips.late;
                        }
                    }
                    row.push(val || "");
                }
            });
            row = _.map(row, function(v){ return Ext.String.format("\"{0}\"", v && v.toString().replace(/"/g, "\"\"") || "");});
            csv.push(row.join(","));
        });

        csv = csv.join("\r\n");
        var fileName = Ext.String.format('feature-schedule-{0}.csv', Rally.util.DateTime.format(new Date(), 'Y-m-d-h-i-s'));
        CA.agile.technicalservices.FileUtilities.saveCSVToFile(csv, fileName);

    },
    updateView: function(timeboxScope){
        this.logger.log('updateView', timeboxScope);

        this.removeAll();

        this.setLoading(true);
        this.fetchUserStories(timeboxScope).then({
            success: this.buildFeatureStore,
            failure: this.showErrorNotification,
            scope: this
        }).always(function(){ this.setLoading(false); }, this);
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
            fetch: ['ObjectID','FormattedID',this.getFeatureName(),'Iteration','EndDate','DirectChildrenCount'],
            filters: filters,
            limit: 'Infinity'
        });
    },
    getFeatureFilters: function(releaseStories){
        var featureOids = [];

        Ext.Array.each(releaseStories, function(s){
            var oid = s.get('Feature') && s.get('Feature').ObjectID;

            if (oid && !Ext.Array.contains(featureOids, oid)){
                featureOids.push(oid);
            }
        });

        var featureFilters = Ext.Array.map(featureOids, function(f){ return { property: 'ObjectID', value: f }});
        if (featureFilters && featureFilters.length > 0){
            featureFilters = Rally.data.wsapi.Filter.or(featureFilters);
            featureFilters = featureFilters.or(this.getContext().getTimeboxScope().getQueryFilter());
        } else {
            featureFilters = this.getContext().getTimeboxScope().getQueryFilter();
        }
        this.logger.log('getFeatureFilters', featureFilters.toString());

        return featureFilters;
    },
    getModelNames: function(){
        return [this.getFeatureTypePath()];
    },
    updateFeatures: function(store, node, records, operation){
        this.logger.log('updateFeatures', records, operation, this.userStories);

        var featureHash = {},
            featureName = this.getFeatureName(),
            missingIteration = [];

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

            if (s.get(featureName) && !s.get('Iteration') && s.get('DirectChildrenCount') === 0){
                missingIteration.push(s.get(featureName).ObjectID);
            }
        });
        this.logger.log('featureHash', featureHash);
        var milestoneOids = [];

        this.suspendEvents();
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
            if (r.get('LeafStoryCount') > 0){
                if (featureHash[oid]){
                    if (featureHash[oid].latestEndDate && featureHash[oid].latestEndDate > r.get('PlannedEndDate')){
                        r.set('__isLate', 2);
                    } else {
                        if (!featureHash[oid].latestEndDate || !r.get('PlannedEndDate') || Ext.Array.contains(missingIteration, oid)){
                            r.set('__isLate',1);
                        }
                    }
                    r.set('__latestIterationEndDate', featureHash[oid].latestEndDate);
                } else {
                    r.set('__isLate',1);
                }
            }

        });
        this.resumeEvents();

        if (milestoneOids.length > 0){
            var filters = Ext.Array.map(milestoneOids, function(m){ return {
                    property: 'ObjectID',
                    value: m
                };
            });
            filters = Rally.data.wsapi.Filter.or(filters);

            this.setLoading("Loading Milestone data...");

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

                    this.suspendEvents();
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
                    this.resumeEvents();
                },
                failure: this.showErrorNotification,
                scope: this
            }).always(function(){ this.setLoading(false);},this);
        }

        if (this.sorters){
            var grid = this.down('rallygridboard').getGridOrBoard(),
                sorter = this.sorters;

                if (sorter.property === '__isLate' ||
                    sorter.property === '__earliestMilestoneDate' ||
                    sorter.property === '__latestMilestoneDate'){
                    Ext.Array.each(grid.columns, function(col){
                        if (col.dataIndex === sorter.property){
                            col.doSort(sorter.direction);
                            return false;
                        }
                    });
                }
        }

    },
    buildFeatureStore: function(stories){
        this.logger.log('buildFeatureStore', stories);
        //if (!stories || stories.length === 0){
        //    this.showAppNotification("No stories were found for the selected Release.");
        //    return;
        //}
        this.userStories = stories;
        var filters = this.getFeatureFilters(stories);

        this.setLoading(true);
        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            models: this.getModelNames(),
           // autoLoad: true,
            enableHierarchy: true,
            fetch: ['PlannedEndDate','Milestones','ObjectID','TargetDate','LeafStoryCount'],
            filters: filters,
            enableRootLevelPostGet: true,
            autoSync: false,
            pageSize: 1000
        }).then({
            success: function(store) {
                store.model.addField({name: '__latestIterationEndDate', type: 'auto', defaultValue: null});
                store.model.addField({name: '__earliestMilestoneDate', type: 'auto', defaultValue: null});
                store.model.addField({name: '__isLate', type: 'auto', defaultValue: null});

                store.on('load', this.updateFeatures, this);
                this.add({
                    xtype: 'rallygridboard',
                    context: this.getContext(),
                    modelNames: this.getModelNames(),
                    toggleState: 'grid',
                    //stateful: true,
                    //stateId: this.getContext().getScopedStateId('fsgridboard'),
                    plugins: this.getGridPlugins(),
                    listeners: {
                        afterrender: function(ct){

                                ct.getHeader().getLeft().add({
                                    xtype: 'rallybutton',
                                    iconCls: 'icon-flag',
                                    cls: 'rly-small secondary',
                                    margin: '3 3 0 25',
                                    toolTipText: "Show only flagged items",
                                    enableToggle: true,
                                    toggleHandler: this.filterFlaggedItems,
                                    scope: this
                                });

                        },
                        scope: this
                    },
                    gridConfig: {
                        //stateful: true,
                        //stateId: this.getContext().getScopedStateId('fsgrid'),
                        pagingToolbarCfg: {
                            pageSizes: [500, 1000, 2000]
                        },
                        store: store,
                        storeConfig: {
                            filters: filters,
                            pageSize: 1000,
                            enableRootLevelPostGet: true
                        },
                        columnCfgs: this.getColumnConfigs(),
                        derivedColumns: this.getDerivedColumns(),
                        listeners: {
                            staterestore: function(x,state){
                                if (state.sorters && state.sorters.length > 0){
                                    this.sorters = state.sorters[0];
                                }
                            },
                            sortchange: function(ct, column, direction){
                                this.sorters = {
                                    property: column.dataIndex,
                                    direction: direction
                                }
                            },
                            scope: this
                        }
                    },
                    height: this.getHeight()
                });
            },
            scope: this
        }).always(function(){ this.setLoading(false); }, this);
    },
    getGridPlugins: function(){
        return [{
            ptype: 'rallygridboardfieldpicker',
            headerPosition: 'left',
            modelNames: this.getModelNames(),
            //stateful: true,
            margin: '3 3 3 25',
            stateId: this.getContext().getScopedStateId('fsfp2')
        },{
            ptype: 'rallygridboardinlinefiltercontrol',
            inlineFilterButtonConfig: {
                stateful: true,
                stateId: this.getContext().getScopedStateId('fsfilter'),
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
                    text: 'Export Current Grid Page...',
                    handler: this.exportCurrentPage, handler: this.exportCurrentPage,
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
            dataIndex: '__isLate',
            xtype: 'templatecolumn',
            text: 'Late Flag',
            tpl:  '<div>' +
            '<tpl if="__isLate==1">' +
            '<div class="flag-missing" ><div class="icon-flag"></div><span class="tooltiptext">' + this.flagTooltips.missing + '</span></div>' +
            '</tpl>' +
            '<tpl if="__isLate==2">' +
            '<div class="flag-late"><div class="icon-flag"></div><span class="tooltiptext">' + this.flagTooltips.late + '</span></div>' +
            '</tpl>' +
            '</div>',
            doSort: function(direction){
                var ds = this.up('rallytreegrid').getStore();
                ds.sort({
                    property: '__isLate',
                    direction: direction,
                    sorterFn: function(v1, v2){
                        var a = v1.get('__isLate') || 0,
                            b = v2.get('__isLate') || 0,
                            dateA = v1.get('__latestIterationEndDate'),
                            dateB = v2.get('__latestIterationEndDate');

                        return a > b ? 1 : (a < b ? -1 : (dateA > dateB ? 1 : (dateA < dateB ? -1 : 0)));
                    }
                });
            }
        },{
            dataIndex: '__latestIterationEndDate',
            xtype: 'templatecolumn',
            text: 'Latest Iteration End Date',
            tpl: '<div style="text-align:right;">{__latestIterationEndDate}</div>',
            doSort: function(direction){
                var ds = this.up('rallytreegrid').getStore();
                ds.sort({
                    property: '__latestIterationEndDate',
                    direction: direction,
                    sorterFn: function(v1, v2){
                        var  dateA = v1.get('__latestIterationEndDate'),
                            dateB = v2.get('__latestIterationEndDate');

                        return dateA > dateB ? 1 : (dateA < dateB ?  -1 : 0 );
                    }
                });
            }
        },{

            dataIndex: '__earliestMilestoneDate',
            xtype: 'templatecolumn',
            text: 'Earliest Milestone Date',
            tpl: '<div style="text-align:right;">{__earliestMilestoneDate}</div>',
            doSort: function(direction) {
                var ds = this.up('rallytreegrid').getStore();
                ds.sort({
                    property: '__earliestMilestoneDate',
                    direction: direction,
                    sorterFn: function (v1, v2) {
                        var dateA = v1.get('__earliestMilestoneDate'),
                            dateB = v2.get('__earliestMilestoneDate');

                        return dateA > dateB ? 1 : (dateA < dateB ? -1 : 0 );
                    }
                });
            }
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
    filterFlaggedItems: function(toggleBtn){
        this.logger.log('filterFlaggedItems', toggleBtn);


        var showAll = true;
        if (!toggleBtn.hasCls('primary')) {
            toggleBtn.addCls('primary');
            toggleBtn.removeCls('secondary');
            toggleBtn.setTooltip("Show All Items");
            showAll = false;
        } else {
            toggleBtn.addCls('secondary');
            toggleBtn.removeCls('primary');
            toggleBtn.setTooltip("Show Late Flagged Items Only");
        }

        var grid = this.down('rallygridboard') && this.down('rallygridboard').getGridOrBoard();
        if (!grid){
            return;
        }

        var node = grid.getStore().getRootNode(),
            toRemove = [];
        if (!showAll){
            node.eachChild(function(n){
                if (n && n.get('__isLate') !== 2){
                    toRemove.push(n);
                }
            });
            Ext.Array.each(toRemove, function(n){
                n.remove(false);
            });
            if (grid.down('rallytreepagingtoolbar')){
                grid.down('rallytreepagingtoolbar')._reRender();
            }
        } else {
            this.updateView(this.getContext().getTimeboxScope());
        }

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
