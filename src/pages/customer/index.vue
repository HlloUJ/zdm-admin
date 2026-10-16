<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminListPage
          v-if="tabs.length"
          v-model:filter-values="filters"
          :tabs="tabs"
          :active-tab="status"
          :filters="filterFields"
          filter-layout="adaptive-grid"
          :actions="toolbarActions"
          :selected-count="selected.length"
          :table-props="{
            rowKey: 'id',
            data: rows,
            columns,
            loading,
            selectedRowKeys: selected,
            hover: true,
            pagination,
          }"
          @tab-change="switchTab"
          @search="search"
          @reset="reset"
          @action="handleToolbarAction"
          @page-change="changePage"
          @select-change="selectRows"
        >
          <template #name="{ row }"
            ><t-link v-if="can('detail')" :theme="buttonTheme('view')" @click="openDetail(row.id)">{{
              row.name
            }}</t-link
            ><span v-else>{{ row.name }}</span></template
          >
          <template #phone="{ row }">{{ displayCustomerPhone(row) }}</template>
          <template #ownerName="{ row }">{{ row.ownerName || '-' }}</template>
          <template #lastFollowedAt="{ row }">{{ time(row.lastFollowedAt) }}</template>
          <template #nextFollowAt="{ row }">{{ time(row.nextFollowAt) }}</template>
          <template #operation="{ row }">
            <t-space break-line size="small">
              <t-link v-if="can('detail')" :theme="buttonTheme('view')" @click="openDetail(row.id)">详情</t-link>
              <t-link v-if="can('edit') && isInDataScope(row)" :theme="buttonTheme('edit')" @click="openProfile(row)"
                >编辑</t-link
              >
              <t-link
                v-if="can('assign')"
                :theme="buttonTheme('assign')"
                @click="prepareAction('assign', [row.id], false)"
                >调整归属</t-link
              >
              <t-link
                v-if="status === 'daily' && can('archive') && isInDataScope(row)"
                :theme="buttonTheme('archive')"
                @click="prepareAction('archive', [row.id], false)"
                >归档</t-link
              >
              <t-link
                v-if="status === 'archived' && can('restore') && isInDataScope(row)"
                :theme="buttonTheme('unarchive')"
                @click="prepareAction('restore', [row.id], false)"
                >取消归档</t-link
              >
              <t-link
                v-if="status === 'archived' && can('purge') && isInDataScope(row)"
                :theme="buttonTheme('purge')"
                @click="prepareAction('purge', [row.id], false)"
                >彻底删除</t-link
              >
            </t-space>
          </template>
          <template #empty>暂无客户</template>
        </AdminListPage>
        <t-empty v-else description="暂无客户管理权限" />
      </main>
    </div>
    <AdminFormDialog
      ref="profileDialog"
      v-model:visible="profileVisible"
      :confirmation="formConfirmation(editingId ? 'edit' : 'create')"
      confirm-function="submit"
      width="480px"
      :data="profile"
      :header="editingId ? '编辑客户' : '新增客户'"
      :confirm-btn="submitButton"
      @confirm="submitProfile"
    >
      <t-form-item label="归属人" required-mark v-bind="profileFeedback.field('owner', profile.ownerAccountId)">
        <t-select
          v-model="profile.ownerAccountId"
          :disabled="Boolean(editingId) && !can('assign', editingStatus)"
          filterable
          clearable
          placeholder="请选择归属人"
          :options="profileOwners.map((owner) => ({ value: owner.accountId, label: owner.name }))"
        />
      </t-form-item>
      <t-form-item label="客户姓名" required-mark v-bind="fieldFeedback(nameError, nameError)"
        ><t-input v-model="profile.name" :maxlength="80" clearable placeholder="请输入客户姓名"
      /></t-form-item>
      <t-form-item label="客户国籍">
        <t-select
          v-model="profile.nationality"
          :options="nationalityOptions"
          filterable
          clearable
          placeholder="请选择客户国籍"
        />
      </t-form-item>
      <t-form-item
        label="号码归属地"
        :required-mark="Boolean(profile.phone) && !unchangedLegacyPhone"
        v-bind="profileFeedback.field('phoneRegion', profile.phoneRegion)"
      >
        <t-select
          v-model="profile.phoneRegion"
          :options="phoneRegionOptions"
          filterable
          clearable
          placeholder="请选择号码归属地"
        />
      </t-form-item>
      <t-form-item label="联系电话" v-bind="profileFeedback.field('phone', profile.phone)">
        <AdminPhoneInput v-model="profile.phone" :calling-code="phoneCallingCode" />
      </t-form-item>
      <t-form-item label="微信号"
        ><t-input v-model="profile.wechat" :maxlength="100" clearable placeholder="请输入微信号"
      /></t-form-item>
      <t-form-item label="客户需求"
        ><t-textarea v-model="profile.requirement" :maxlength="100" placeholder="请输入客户需求"
      /></t-form-item>
      <t-form-item label="客户备注"
        ><t-textarea v-model="profile.remark" :maxlength="100" placeholder="请输入客户备注"
      /></t-form-item>
    </AdminFormDialog>
    <AdminDialog
      v-model:visible="detailVisible"
      :confirmation="{ kind: 'close', text: '关闭' }"
      confirm-function="close"
      header="客户详情"
      width="min(1100px, 94vw)"
      :cancel-btn="null"
      @confirm="detailVisible = false"
    >
      <t-loading :loading="detailLoading">
        <t-skeleton v-if="detailLoading" theme="paragraph" />
        <template v-if="detail">
          <AdminDetailPage embedded title="客户资料" :items="detailItems">
            <t-space
              ><span>跟进记录</span
              ><t-button v-if="isInDataScope(detail.customer)" :theme="buttonTheme('create')" @click="openFollowup()"
                >新增跟进</t-button
              ></t-space
            >
            <t-list :split="true">
              <t-list-item v-for="record in detail.followups" :key="record.id">
                <t-space direction="vertical">
                  <t-space
                    ><span>{{ time(record.followedAt) }}</span
                    ><span>{{ record.createdByName || '-' }}</span></t-space
                  >
                  <div>{{ record.content }}</div>
                  <t-space v-if="record.attachments.length" break-line
                    ><t-link
                      v-for="attachment in record.attachments"
                      :key="attachment.mediaId"
                      :theme="buttonTheme('preview')"
                      @click="previewAttachment(record, attachment)"
                      >{{ attachment.name }}</t-link
                    ></t-space
                  >
                  <span v-if="record.nextFollowAt || record.nextFollowTask"
                    >下次跟进：{{ time(record.nextFollowAt) }} {{ record.nextFollowTask }}</span
                  >
                </t-space>
                <template v-if="isInDataScope(detail.customer)" #action
                  ><t-space
                    ><t-link :theme="buttonTheme('edit')" @click="openFollowup(record)">编辑</t-link
                    ><t-link :theme="buttonTheme('delete')" @click="prepareFollowupDelete(record.id)"
                      >删除</t-link
                    ></t-space
                  ></template
                >
              </t-list-item>
            </t-list>
            <t-empty v-if="!detail.followups.length" description="暂无跟进记录" />
          </AdminDetailPage>
        </template>
      </t-loading>
    </AdminDialog>
    <AdminFormDialog
      ref="followDialog"
      v-model:visible="followVisible"
      :confirmation="formConfirmation(followId ? 'edit' : 'create')"
      confirm-function="submit"
      :data="followForm"
      label-width="calc(7em + var(--td-comp-paddingLR-xl))"
      :header="followId ? '编辑跟进' : '新增跟进'"
      width="720px"
      form-layout="custom"
      :confirm-btn="submitButton"
      @confirm="submitFollowup"
      @closed="cleanupUploads"
    >
      <t-form-item label="跟进时间" required-mark v-bind="followFeedback.field('time', followForm.followedAt)"
        ><t-date-picker
          v-model="followForm.followedAt"
          placeholder="请选择日期时间"
          enable-time-picker
          format="YYYY-MM-DD HH:mm:ss"
      /></t-form-item>
      <t-form-item label="跟进内容" required-mark v-bind="followFeedback.field('content', followForm.content)"
        ><t-textarea v-model="followForm.content" :maxlength="10000" placeholder="请输入跟进内容"
      /></t-form-item>
      <t-form-item label="下次跟进时间"
        ><t-date-picker
          v-model="followForm.nextFollowAt"
          placeholder="请选择日期时间"
          enable-time-picker
          clearable
          format="YYYY-MM-DD HH:mm:ss"
      /></t-form-item>
      <t-form-item label="下次跟进事项"
        ><t-textarea v-model="followForm.nextFollowTask" :maxlength="2000" placeholder="请输入下次跟进事项"
      /></t-form-item>
      <t-form-item label="附件" help="最多3个附件，单个不超过5MiB">
        <t-row :gutter="[16, 16]">
          <t-col v-for="(_, index) in 3" :key="index" :span="12">
            <AdminOfficialMediaUpload
              :model-value="uploads[index]"
              :title="`附件${index + 1}`"
              :show-title="false"
              :accept="''"
              :media-type="uploadKinds[index] === 'image' ? 'image' : 'file'"
              :upload="(file) => upload(file, index)"
              @update:model-value="(value) => (uploads[index] = value)"
              @preview="(value) => previewUpload(value, index)"
            />
          </t-col>
        </t-row>
      </t-form-item>
    </AdminFormDialog>
    <AdminFormDialog
      ref="assignDialog"
      v-model:visible="assignVisible"
      :confirmation="operationConfirmation('调整归属', pending.batch)"
      confirm-function="assign"
      :data="{ ownerAccountId: newOwner }"
      header="调整归属"
      :confirm-btn="submitButton"
      @confirm="submitAction"
    >
      <t-form-item label="选中客户"
        ><span>{{ pending.ids.length }} 条</span></t-form-item
      >
      <t-form-item label="新归属人" required-mark v-bind="assignFeedback.field('owner', newOwner)"
        ><t-select v-model="newOwner" filterable clearable placeholder="请选择新归属人"
          ><t-option
            v-for="owner in owners.filter((item) => item.active)"
            :key="owner.accountId"
            :value="owner.accountId"
            :label="owner.name" /></t-select
      ></t-form-item>

      <template #after
        ><t-alert v-if="pending.status === 'archived'" theme="info" message="调整归属后，客户将自动恢复为日常客户。"
      /></template>
    </AdminFormDialog>
    <AdminConfirmDialog
      v-model:visible="confirmVisible"
      :function="deletingFollowId != null ? 'delete' : buttonFunctionFor('customer', pending.action)"
      :batch="deletingFollowId == null && pending.batch"
      :action="confirmAction"
      object-type="客户"
      :description="confirmDescription"
      @confirm="confirmOperation"
    />
    <t-image-viewer v-model:visible="imageVisible" :images="previewImages" />
  </div>
</template>
<script setup lang="ts">
import { formConfirmation, operationConfirmation } from '@/components/foundation/actions/confirmation';
import { buttonTheme, buttonFunctionFor } from '@/components/foundation/actions/buttonFunctions';
import { rejectFormSubmission } from '@/utils/submitValidation';
import { fieldFeedback, useFormFeedback } from '@/utils/formValidation';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { PageInfo, TableProps } from 'tdesign-vue-next';
import AdminTopNav from '@/components/AdminTopNav.vue';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import {
  AdminListPage,
  AdminFormDialog,
  AdminPhoneInput,
  AdminDetailPage,
  AdminDialog,
  AdminConfirmDialog,
  AdminOfficialMediaUpload,
} from '@/components/foundation';
import type { ListAction, ListFilter } from '@/components/foundation';
import type { AdminMediaValue } from '@/components/foundation/AdminMediaUpload.vue';
import { adminFeedback } from '@/components/foundation/feedback/adminFeedback';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import {
  listCustomers,
  listCustomerOwners,
  listCustomerOwnerCandidates,
  listCustomerContactRegions,
  displayCustomerPhone,
  type CustomerContactCatalogue,
  getCustomerDetail,
  saveCustomer,
  actOnCustomers,
  saveFollowup,
  deleteFollowup,
  uploadAttachment,
  releaseAttachment,
  loadAttachment,
} from '@/services/customers';
import type {
  Customer,
  CustomerStatus,
  CustomerProfile,
  CustomerDetail,
  CustomerAction,
  Owner,
  Followup,
  Attachment,
} from '@/services/customers';
const user = computed(() => getLoginUser());
const status = ref<CustomerStatus>('daily');
const can = (action: string, tab = status.value) =>
  hasPermission(user.value, `store.customer-management.${tab}.${action}`);
const tabs = computed(() =>
  [
    { value: 'daily' as const, label: '日常客户' },
    { value: 'archived' as const, label: '归档客户' },
  ].filter((tab) => can('view', tab.value)),
);
const allData = computed(() => user.value.dataPermission === 'all' || user.value.roles.includes('SUPER_ADMIN'));
const isInDataScope = (row: Customer) =>
  allData.value || (user.value.dataPermission === 'self' && row.ownerAccountId === user.value.id);
const rows = ref<Customer[]>([]);
const owners = ref<Owner[]>([]);
const loading = ref(false);
const selected = ref<number[]>([]);
const filters = ref<{ name: string; phone: string; ownerAccountId?: number }>({ name: '', phone: '' });
const page = ref(1);
const pageSize = ref(10);
const pagination = computed(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: rows.value.length,
  pageSizeOptions: [10, 20, 50],
}));
function changePage(info: PageInfo) {
  page.value = info.current;
  pageSize.value = info.pageSize;
}
const selectionInDataScope = computed(
  () =>
    selected.value.length > 0 &&
    selected.value.every((id) => rows.value.some((row) => row.id === id && isInDataScope(row))),
);
const filterFields = computed<ListFilter[]>(() => [
  { key: 'name', label: '客户姓名' },
  { key: 'phone', label: '联系电话' },
  ...(allData.value
    ? [
        {
          key: 'ownerAccountId',
          label: '归属人',
          kind: 'select' as const,
          filterable: true,
          options: owners.value.map((owner) => ({ value: owner.accountId, label: ownerLabel(owner) })),
        },
      ]
    : []),
]);
const toolbarActions = computed<ListAction[]>(() => [
  ...(status.value === 'daily' && can('create')
    ? [{ id: 'create', function: 'create' as const, label: '新增', icon: 'add' }]
    : []),
  ...(can('batch-assign')
    ? [
        {
          id: 'assign',
          function: 'assign' as const,
          batch: true,
          label: '批量调整归属',
          disabled: !selected.value.length,
        },
      ]
    : []),
  ...(status.value === 'daily' && can('batch-archive')
    ? [
        {
          id: 'archive',
          function: 'archive' as const,
          batch: true,
          label: '批量归档',
          disabled: !selectionInDataScope.value,
        },
      ]
    : []),
  ...(status.value === 'archived' && can('batch-restore')
    ? [
        {
          id: 'restore',
          function: 'unarchive' as const,
          batch: true,
          label: '批量取消归档',
          disabled: !selectionInDataScope.value,
        },
      ]
    : []),
  ...(status.value === 'archived' && can('batch-purge')
    ? [
        {
          id: 'purge',
          function: 'purge' as const,
          batch: true,
          label: '批量彻底删除',
          disabled: !selectionInDataScope.value,
        },
      ]
    : []),
]);
function handleToolbarAction(id: string) {
  if (id === 'create') openProfile();
  else if (id === 'assign' || id === 'archive' || id === 'restore' || id === 'purge')
    prepareAction(id, selected.value, true);
}
const columns: TableProps['columns'] = [
  { colKey: 'row-select', type: 'multiple', width: 46 },
  { colKey: 'name', title: '客户姓名', width: 90, ellipsis: true },
  { colKey: 'phone', title: '联系电话', width: 120, ellipsis: true },
  { colKey: 'ownerName', title: '归属人', width: 80, ellipsis: true },
  { colKey: 'requirement', title: '客户需求', width: 120, ellipsis: true },
  { colKey: 'lastFollowedAt', title: '最近跟进时间', width: 130, ellipsis: true },
  { colKey: 'nextFollowAt', title: '下次跟进时间', width: 130, ellipsis: true },
  { colKey: 'operation', title: '操作', width: 200 },
];
const detailItems = computed(() => {
  const customer = detail.value?.customer;
  if (!customer) return [];
  return [
    { label: '客户姓名', value: customer.name },
    {
      label: '客户国籍',
      value:
        contactCatalogue.value.nationalities.find((item) => item.code === customer.nationality)?.name ||
        customer.nationality ||
        '-',
    },
    { label: '联系电话', value: displayCustomerPhone(customer) },
    {
      label: '号码归属地',
      value:
        contactCatalogue.value.phoneRegions.find((item) => item.code === customer.phoneRegion)?.name ||
        customer.phoneRegion ||
        '-',
    },
    { label: '微信号', value: customer.wechat || '-' },
    { label: '归属人', value: customer.ownerName || '-' },
    { label: '建档人', value: customer.createdByName || '-' },
    { label: '建档时间', value: time(customer.createdAt) },
    { label: '客户需求', value: customer.requirement || '-', span: 3 },
    { label: '客户备注', value: customer.remark || '-', span: 3 },
  ];
});
const time = (value?: string) => (value ? value.replace('T', ' ').slice(0, 19) : '-');
const ownerLabel = (owner: Owner) => `${owner.name}${owner.active ? '' : '（已离职或停用）'}`;
let loadVersion = 0;
async function reload() {
  const version = ++loadVersion;
  rows.value = [];
  owners.value = [];
  selected.value = [];
  loading.value = true;
  if (!tabs.value.length) {
    loading.value = false;
    return;
  }
  try {
    const [data, people] = await Promise.all([
      listCustomers(
        status.value,
        filters.value.name,
        filters.value.phone,
        allData.value ? filters.value.ownerAccountId : undefined,
      ),
      listCustomerOwners(status.value),
    ]);
    if (version === loadVersion) {
      rows.value = data;
      owners.value = people;
      page.value = Math.min(page.value, Math.max(1, Math.ceil(data.length / pageSize.value)));
    }
  } catch (error) {
    if (version === loadVersion) fail('查询', error);
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}
function fail(action: string, error: unknown) {
  adminFeedback.actionError({ action, error });
}
function selectRows(keys: (string | number)[]) {
  selected.value = keys.map(Number);
}
function switchTab(value: string | number) {
  status.value = value as CustomerStatus;
  page.value = 1;
  void reload();
}
function search() {
  page.value = 1;
  void reload();
}
function reset() {
  filters.value = { name: '', phone: '' };
  search();
}
watch(
  () => [
    user.value.id,
    user.value.identityId,
    user.value.tenantId,
    user.value.storeId,
    user.value.permissions.join(','),
    user.value.dataPermission,
  ],
  () => {
    ++detailVersion;
    detailVisible.value = false;
    profileVisible.value = false;
    followVisible.value = false;
    assignVisible.value = false;
    confirmVisible.value = false;
    filters.value = { name: '', phone: '' };
    status.value = tabs.value[0]?.value ?? 'daily';
    void reload();
  },
);
const profileVisible = ref(false);
const editingId = ref<number>();
const nameError = ref('');
const editingStatus = ref<CustomerStatus>('daily');
const profileOwners = ref<Owner[]>([]);
const profileFeedback = useFormFeedback(profileVisible);
const emptyProfile = (): CustomerProfile => ({
  name: '',
  phone: '',
  nationality: '',
  phoneRegion: '',
  wechat: '',
  requirement: '',
  remark: '',
});
const profile = ref<CustomerProfile>(emptyProfile());
const originalContact = ref({ phone: '', phoneRegion: '' });
const contactCatalogue = ref<CustomerContactCatalogue>({ nationalities: [], phoneRegions: [] });
const nationalityOptions = computed(() =>
  contactCatalogue.value.nationalities.map((item) => ({ value: item.code, label: item.name })),
);
const phoneRegionOptions = computed(() =>
  contactCatalogue.value.phoneRegions.map((item) => ({ value: item.code, label: `${item.name} ${item.callingCode}` })),
);
const phoneCallingCode = computed(
  () => contactCatalogue.value.phoneRegions.find((item) => item.code === profile.value.phoneRegion)?.callingCode ?? '',
);
const unchangedLegacyPhone = computed(
  () =>
    Boolean(editingId.value) &&
    !originalContact.value.phoneRegion &&
    !profile.value.phoneRegion &&
    profile.value.phone === originalContact.value.phone,
);

const submitting = ref(false);
const uploading = ref(0);
const submitButton = computed(() => ({
  loading: submitting.value || uploading.value > 0,
  disabled: submitting.value,
}));
async function openProfile(row?: Customer) {
  const currentIdentity = user.value;
  try {
    const [candidates, catalogue] = await Promise.all([
      listCustomerOwnerCandidates(row?.id),
      listCustomerContactRegions(row?.status ?? status.value),
    ]);
    if (user.value !== currentIdentity) return;
    profileOwners.value = candidates.filter((owner) => owner.active);
    contactCatalogue.value = catalogue;
  } catch (error) {
    return fail('查询归属人', error);
  }
  editingId.value = row?.id;
  profile.value = row
    ? {
        name: row.name,
        phone: row.phone,
        nationality: row.nationality ?? '',
        phoneRegion: row.phoneRegion ?? '',
        wechat: row.wechat,
        requirement: row.requirement,
        remark: row.remark,
      }
    : emptyProfile();
  profile.value.ownerAccountId =
    row?.ownerAccountId ??
    (profileOwners.value.some((owner) => owner.accountId === user.value.id) ? user.value.id : undefined);
  editingStatus.value = row?.status ?? 'daily';
  originalContact.value = { phone: row?.phone ?? '', phoneRegion: row?.phoneRegion ?? '' };
  nameError.value = '';
  profileVisible.value = true;
}
async function submitProfile() {
  if (submitting.value) return;
  let invalid = false;
  if (!profile.value.name.trim()) {
    nameError.value = '请输入客户姓名';
    invalid = true;
  }
  if (!profileOwners.value.some((owner) => owner.accountId === profile.value.ownerAccountId)) {
    profileFeedback.reject('owner', profile.value.ownerAccountId, '请选择归属人');
    invalid = true;
  }
  if (profile.value.phone && !unchangedLegacyPhone.value) {
    if (!/^[0-9]+$/.test(profile.value.phone)) {
      profileFeedback.reject('phone', profile.value.phone, '联系电话仅允许输入数字');
      invalid = true;
    }
    if (!profile.value.phoneRegion) {
      profileFeedback.reject('phoneRegion', profile.value.phoneRegion, '请选择号码归属地');
      invalid = true;
    }
  }
  if (invalid) return rejectFormSubmission(profileDialog.value);
  submitting.value = true;
  try {
    await saveCustomer(profile.value, editingId.value);
    profileVisible.value = false;
    adminFeedback.actionSuccess({ action: editingId.value ? '修改' : '新增' });
    await reload();
  } catch (error) {
    fail('保存', error);
  } finally {
    submitting.value = false;
  }
}
const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<CustomerDetail>();
let detailVersion = 0;
async function openDetail(id: number) {
  const version = ++detailVersion;
  detail.value = undefined;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const [result, catalogue] = await Promise.all([getCustomerDetail(id), listCustomerContactRegions(status.value)]);
    if (version === detailVersion) contactCatalogue.value = catalogue;
    if (version === detailVersion) detail.value = result;
  } catch (error) {
    if (version === detailVersion) {
      detailVisible.value = false;
      fail('查看', error);
    }
  } finally {
    if (version === detailVersion) detailLoading.value = false;
  }
}
const pending = ref<{ ids: number[]; status: CustomerStatus; action: CustomerAction; batch: boolean }>({
  ids: [],
  status: 'daily',
  action: 'archive',
  batch: false,
});
const assignVisible = ref(false);
const profileDialog = ref<InstanceType<typeof AdminFormDialog>>();
const followDialog = ref<InstanceType<typeof AdminFormDialog>>();
const assignDialog = ref<InstanceType<typeof AdminFormDialog>>();
const assignFeedback = useFormFeedback(assignVisible);
const newOwner = ref<number>();
const confirmVisible = ref(false);
const deletingFollowId = ref<number>();
const actionLabels = { assign: '调整归属', archive: '归档', restore: '取消归档', purge: '彻底删除' };
const confirmAction = computed(() =>
  deletingFollowId.value != null ? '删除跟进记录' : actionLabels[pending.value.action],
);
const confirmDescription = computed(() =>
  deletingFollowId.value != null
    ? '是否删除该跟进记录？'
    : pending.value.action === 'purge'
      ? `是否彻底删除选中的${pending.value.ids.length}条客户档案及全部跟进和附件？删除后无法恢复，已有订单不受影响。`
      : `是否${actionLabels[pending.value.action]}选中的${pending.value.ids.length}条客户档案？`,
);
function prepareAction(action: CustomerAction, ids: number[], batch: boolean) {
  pending.value = { action, ids: [...ids], batch, status: status.value };
  deletingFollowId.value = undefined;
  if (action === 'assign') {
    newOwner.value = undefined;
    assignVisible.value = true;
  } else confirmVisible.value = true;
}
async function submitAction() {
  if (submitting.value) return;
  if (pending.value.action === 'assign' && !newOwner.value) {
    assignFeedback.reject('owner', newOwner.value, '请选择新归属人');
    return rejectFormSubmission(assignDialog.value);
  }
  submitting.value = true;
  try {
    await actOnCustomers(
      pending.value.ids,
      pending.value.status,
      pending.value.action,
      pending.value.batch,
      newOwner.value,
    );
    assignVisible.value = false;
    confirmVisible.value = false;
    detailVisible.value = false;
    adminFeedback.actionSuccess({ action: actionLabels[pending.value.action] });
    await reload();
  } catch (error) {
    fail(actionLabels[pending.value.action], error);
    await reload();
  } finally {
    submitting.value = false;
  }
}
function prepareFollowupDelete(id: number) {
  deletingFollowId.value = id;
  confirmVisible.value = true;
}
async function confirmOperation() {
  if (deletingFollowId.value == null) {
    await submitAction();
    return;
  }
  if (!detail.value || submitting.value) return;
  submitting.value = true;
  try {
    await deleteFollowup(detail.value.customer.id, deletingFollowId.value);
    confirmVisible.value = false;
    detail.value = await getCustomerDetail(detail.value.customer.id);
    await reload();
  } catch (error) {
    fail('删除', error);
  } finally {
    submitting.value = false;
  }
}
const followVisible = ref(false);
const followFeedback = useFormFeedback(followVisible);
const followId = ref<number>();
const localNow = () => {
  const date = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const followForm = ref({ followedAt: '', content: '', nextFollowAt: '', nextFollowTask: '' });
const uploads = ref<(AdminMediaValue | undefined)[]>([]);
const uploadKinds = ref<string[]>([]);
const newUploads = new Set<number>();
const blobUrls = new Set<string>();
let uploadCustomerId: number | undefined;
let uploadGeneration = 0;
function blobUrl(blob: Blob) {
  const url = URL.createObjectURL(blob);
  blobUrls.add(url);
  return url;
}
function openFollowup(record?: Followup) {
  if (!detail.value) return;
  ++uploadGeneration;
  uploadCustomerId = detail.value.customer.id;
  followId.value = record?.id;
  followForm.value = {
    followedAt: record ? time(record.followedAt) : localNow(),
    content: record?.content ?? '',
    nextFollowAt: record?.nextFollowAt ? time(record.nextFollowAt) : '',
    nextFollowTask: record?.nextFollowTask ?? '',
  };
  uploads.value = record?.attachments.map((a) => ({ name: a.name, mediaId: a.mediaId })) ?? [];
  uploadKinds.value = record?.attachments.map((a) => a.mediaType) ?? [];
  followVisible.value = true;
}
async function upload(file: File, index: number) {
  if (!uploadCustomerId) throw new Error('请先选择客户');
  const customerId = uploadCustomerId;
  const generation = uploadGeneration;
  uploading.value++;
  let result;
  try {
    result = await uploadAttachment(customerId, file);
  } finally {
    uploading.value--;
  }
  newUploads.add(result.id);
  if (!followVisible.value || generation !== uploadGeneration) {
    await releaseAttachment(customerId, result.id);
    newUploads.delete(result.id);
    throw new Error('跟进编辑已关闭');
  }
  uploadKinds.value[index] = result.mediaType;
  return { name: file.name, mediaId: result.id, url: blobUrl(file) };
}
async function cleanupUploads() {
  ++uploadGeneration;
  const ids = [...newUploads];
  newUploads.clear();
  if (uploadCustomerId) {
    const results = await Promise.allSettled(ids.map((id) => releaseAttachment(uploadCustomerId!, id)));
    if (results.some((r) => r.status === 'rejected')) adminFeedback.warning('部分临时附件释放失败，系统将自动回收');
  }
  uploads.value = [];
}
async function submitFollowup() {
  if (!detail.value || submitting.value || uploading.value > 0) return;
  if (!followForm.value.followedAt || !followForm.value.content.trim()) {
    if (!followForm.value.followedAt) followFeedback.reject('time', followForm.value.followedAt, '请选择跟进时间');
    if (!followForm.value.content.trim()) followFeedback.reject('content', followForm.value.content, '请输入跟进内容');
    return rejectFormSubmission(followDialog.value);
  }
  submitting.value = true;
  try {
    const ids = uploads.value.flatMap((a) => (a?.mediaId ? [a.mediaId] : []));
    await saveFollowup(
      detail.value.customer.id,
      {
        ...followForm.value,
        followedAt: followForm.value.followedAt.replace(' ', 'T'),
        nextFollowAt: followForm.value.nextFollowAt ? followForm.value.nextFollowAt.replace(' ', 'T') : null,
        mediaIds: ids,
      },
      followId.value,
    );
    ids.forEach((id) => newUploads.delete(id));
    followVisible.value = false;
    detail.value = await getCustomerDetail(detail.value.customer.id);
    await reload();
    adminFeedback.actionSuccess({ action: '保存跟进' });
  } catch (error) {
    fail('保存跟进', error);
  } finally {
    submitting.value = false;
  }
}
const imageVisible = ref(false);
const previewImages = ref<string[]>([]);
function displayFile(url: string, name: string, image: boolean) {
  if (image) {
    previewImages.value = [url];
    imageVisible.value = true;
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
  }
}
async function previewAttachment(record: Followup, attachment: Attachment) {
  if (!detail.value) return;
  try {
    const blob = await loadAttachment(detail.value.customer.id, record.id, attachment.mediaId);
    displayFile(blobUrl(blob), attachment.name, attachment.mediaType === 'image');
  } catch (error) {
    fail('查看附件', error);
  }
}
async function previewUpload(value: AdminMediaValue | undefined, index: number) {
  if (!value) return;
  if (value.url) {
    displayFile(value.url, value.name, uploadKinds.value[index] === 'image');
    return;
  }
  const record = detail.value?.followups.find((f) => f.id === followId.value);
  const attachment = record?.attachments.find((a) => a.mediaId === value.mediaId);
  if (record && attachment) await previewAttachment(record, attachment);
}
onBeforeUnmount(() => {
  ++loadVersion;
  ++detailVersion;
  void cleanupUploads();
  blobUrls.forEach((url) => URL.revokeObjectURL(url));
});
status.value = tabs.value[0]?.value ?? 'daily';
void reload();
</script>
