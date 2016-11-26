Ext.override(Rally.ui.grid.TreeGrid, {
    _mergeColumnConfigs: function(newColumns, oldColumns) {

        var mergedColumns= _.map(newColumns, function(newColumn) {
            var oldColumn = _.find(oldColumns, {dataIndex: this._getColumnName(newColumn)});
            if (oldColumn) {
                return this._getColumnConfigFromColumn(oldColumn);
            }

            return newColumn;
        }, this);
        mergedColumns = mergedColumns.concat(this.config.derivedColumns);
        return mergedColumns;
    },

    _isStatefulColumn: function(columnName) {
        var unstatefulColumns = _.pluck(this.config.derivedColumns, 'dataIndex');
        if (Ext.Array.contains(unstatefulColumns, columnName)){
            return false;
        }
        if (!this.allColumnsStateful) {
            columnName = columnName.toLowerCase();

            if (this.store.enableHierarchy && columnName === this.treeColumnDataIndex.toLowerCase()) {
                return false;
            }

            if (this.enableRanking && columnName === this.rankColumnDataIndex.toLowerCase()) {
                return false;
            }
        }

        return true;
    },
    _getColumnConfigsBasedOnCurrentOrder: function(columnConfigs) {
        return _(this.headerCt.items.getRange()).map(function(column) {
            //override:  Added additional search for column.text
            return _.contains(columnConfigs, column.dataIndex) ? column.dataIndex : _.find(columnConfigs, {dataIndex: column.dataIndex, text: column.text});
        }).compact().value();
    },
    _restoreColumnOrder: function(columnConfigs) {

        var currentColumns = this._getColumnConfigsBasedOnCurrentOrder(columnConfigs);
        var addedColumns = _.filter(columnConfigs, function(config) {
            return !_.find(currentColumns, {dataIndex: config.dataIndex}) || Ext.isString(config);
        });
        return currentColumns.concat(addedColumns);
    },
    _applyStatefulColumns: function(columns) {
        if (this.alwaysShowDefaultColumns) {
            _.each(this.columnCfgs, function(columnCfg) {
                if (!_.any(columns, {dataIndex: this._getColumnName(columnCfg)})) {
                    columns.push(columnCfg);
                }
            }, this);
        }
        if (this.config && this.config.derivedColumns){
            this.columnCfgs = columns.concat(this.config.derivedColumns);
        } else {
            this.columnCfgs = columns;
        }

    },
    _getPersistableColumnConfig: function(column) {
        var columnConfig = this._getColumnConfigFromColumn(column),
            field = this._getModelField(columnConfig.dataIndex);
        if (field && field.getUUID && field.getUUID()) {
            columnConfig.dataIndex = field.getUUID();
        }
        return columnConfig;
    },
    _getPersistableSorter: function(sorterProperty) {
        var field = this._getModelField(sorterProperty);
        return (field && field.getUUID && field.getUUID()) || sorterProperty;
    },

    applyState: function(state) {
        this.appliedState = state;
        this.fireEvent('beforestaterestore', this, state);

        if (state.columns) {
            state.columns = _.reject(state.columns, function(col) {
                return !this._getColumnName(col);
            }, this);
            // make sure flex is set correctly for column configs saved in a preference
            _.each(state.columns, this._setColumnFlex, this);
            state.columns = _.map(state.columns, this._transformUuidsToNames, this);
            this._applyStatefulColumns(state.columns);
        }

        if (state.pagingToolbar) {
            var store = this.getStore(),
                pageSize = state.pagingToolbar.pageSize,
                currentPage = state.pagingToolbar.currentPage;
            if (this.pagingToolbarCfg) {
                var maxPageSize = _.last(this.pagingToolbarCfg.pageSizes);
                if (maxPageSize && maxPageSize < pageSize) {
                    pageSize = maxPageSize;
                    currentPage = 1;
                }
            }
            store.pageSize = pageSize;
            store.currentPage = currentPage;
        }

        if (state.sorters) {
            _.each(state.sorters, this._transformUuidsToSorterProperty, this);
            var sorters = _.transform(state.sorters, function (collection, sorterState) {
                if(Rally.data.Ranker.isRankField(sorterState.property)) {
                    sorterState.property = Rally.data.Ranker.getRankField(this.store.model);
                }

                collection.add(Ext.create('Ext.util.Sorter', {
                    property: sorterState.property,
                    direction: sorterState.direction
                }));
            }, Ext.create('Ext.util.MixedCollection'), this);
            this.getStore().sorters = sorters;
        }

        if (state.expandedRowPersistence) {
            this.expandedRowPersistenceState = state.expandedRowPersistence;
        }

        this.fireEvent('staterestore', this, state);
    }
});

Ext.override(Rally.ui.tree.PagingToolbar, {

    _onSubsequentLoads : function(store, node, records, successful, options) {
        var hasTopLevelRecord = _.any(records, function(record) {
            var isChildRecord = record.get('depth') > 1;
            return !isChildRecord;
        });

        if (hasTopLevelRecord) {
            this._reRender();
        }

        this._recordMetricsEnd();
    },
    _reRender : function() {
        if (this.rendered !== true) {
            return;
        }

        this._cleanupAdditionalComponents();

        this.renderData = this._getPageData();
        console.log('thisrenderData', this.renderData);
        this.renderTpl.overwrite(this.getTargetEl(), this.renderData);

        this.applyRenderSelectors();
        this._addPageSizeCombobox();
        this._addButtons();

        this.fireEvent('change', this, this.renderData);
    },
    _getPageData: function() {
        var store = this.getStore();

        if (!store) {
            return {
                total: 0,
                currentPage: 0,
                pageCount: 0,
                pageSize : 0,
                start: 0,
                end: 0,
                pageSizes: 0
            };
        }

        //var totalCount = store.getTotalCount() || 0,
        //    start = ((store.currentPage - 1) * store.pageSize) + 1;

        //Get the visible nodes instead of the total count since we are doing some client side filtering
        var totalCount = store.getRootNode().childNodes && store.getRootNode().childNodes.length || 0,
            start = ((store.currentPage - 1) * store.pageSize) + 1;

        if (totalCount === 0) {
            start = 0;
        }

        return {
            total: totalCount,
            currentPage: store.currentPage,
            pageCount: Math.ceil(totalCount / store.pageSize),
            pageSize : store.pageSize,
            start: start,
            end: Math.min(store.currentPage * store.pageSize, totalCount),
            pageSizes: this.getPageSizes()
        };
    }
});