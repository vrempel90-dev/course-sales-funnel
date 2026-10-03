"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
type Row = Record<string, unknown>;
type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "checkbox" | "password";
  options?: [string, string][];
  nullable?: boolean;
  required?: boolean;
};
type Data = {
  items?: Row[];
  total?: number;
  page?: number;
  clients?: number;
  newClients?: number;
  pendingReview?: number;
  accessFailed?: number;
  managerRequests?: number;
  funnel?: {
    type: string;
    label: string;
    count: number;
    conversion: number | null;
  }[];
  revenue?: { currency: string; _sum: { amount: string } }[];
  recentPayments?: Row[];
  settings?: { key: string; value: Row }[];
  telegram?: Row;
};
const object = (value: unknown): Row =>
  value && typeof value === "object" ? (value as Row) : {};
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(object) : [];
const str = (value: unknown) =>
  value === null || value === undefined ? "—" : String(value);
const dt = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString("ru-RU") : "—";
const name = (value: unknown) => {
  const row = object(value);
  return str(row.title || row.name || row.firstName);
};
const stages = [
  "NEW",
  "TELEGRAM_STARTED",
  "QUESTIONNAIRE_STARTED",
  "QUESTIONNAIRE_COMPLETED",
  "COURSE_RECOMMENDED",
  "DEMO_VIEWED",
  "COURSE_SELECTED",
  "PAYMENT_STARTED",
  "WAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "PAID",
  "ACCESS_GRANTED",
  "MANAGER_REQUESTED",
];
const options = (values: string[]) =>
  values.map((value) => [value, value] as [string, string]);
const nav = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["clients", "Клиенты", Users],
  ["courses", "Курсы", BookOpen],
  ["categories", "Направления", ListFilter],
  ["recommendations", "Рекомендации", SlidersHorizontal],
  ["payments", "Оплаты", CreditCard],
  ["access", "Доступы", ShieldCheck],
  ["requests", "Запросы менеджеру", MessageSquare],
  ["funnel", "Воронка", Activity],
  ["settings", "Настройки", Settings],
  ["admins", "Сотрудники", Users],
  ["audit", "Журнал действий", Activity],
  ["jobs", "Уведомления", MessageSquare],
] as const;
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const result = await response.json();
  if (response.status === 401)
    window.location.replace(new URL("/login", window.location.origin).href);
  if (!response.ok)
    throw new Error(result.error || "Не удалось выполнить действие");
  return result;
}
export function AdminWorkspace({
  admin,
  section,
  detailId,
}: {
  admin: { id: string; name: string; role: string };
  section: string;
  detailId?: string;
}) {
  const [data, setData] = useState<Data>({});
  const [detail, setDetail] = useState<Row | null>(null);
  const [lookups, setLookups] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [currency, setCurrency] = useState("");
  const [course, setCourse] = useState("");
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [settingKey, setSettingKey] = useState("");
  const [draft, setDraft] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const isAdmin = admin.role === "ADMIN";
  const title = nav.find((entry) => entry[0] === section)?.[1] || "Раздел";
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        q: search,
        status,
        currency,
        courseId: course,
        date,
      });
      if (detailId) params.set("id", detailId);
      const result = await api(`/api/admin/${section}?${params}`);
      if (detailId) setDetail(result);
      else setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [section, detailId, page, search, status, currency, course, date]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api("/api/admin/lookups")
      .then(setLookups)
      .catch(() => {});
  }, []);
  async function action(
    action: string,
    id?: string,
    reason?: string,
    reconciled = false,
    revision?: number,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/admin/actions", {
        method: "POST",
        body: JSON.stringify({ action, id, reason, reconciled, revision }),
      });
      setNotice(
        action === "telegram-test"
          ? `Telegram подключён: @${result.username}`
          : "Действие выполнено",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  const lookupOptions = (key: string): [string, string][] =>
    (lookups[key] || []).map((item) => [str(item.id), name(item)]);
  function fields(): Field[] {
    if (section === "courses")
      return [
        { key: "title", label: "Название", required: true },
        { key: "slug", label: "Slug (латиница)", required: true },
        {
          key: "categoryId",
          label: "Направление",
          type: "select",
          options: lookupOptions("categories"),
          required: true,
        },
        {
          key: "status",
          label: "Статус",
          type: "select",
          options: options(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]),
        },
        {
          key: "shortDescription",
          label: "Краткое описание",
          type: "textarea",
          required: true,
        },
        {
          key: "fullDescription",
          label: "Полное описание",
          type: "textarea",
          required: true,
        },
        {
          key: "program",
          label: "Программа",
          type: "textarea",
          required: true,
        },
        { key: "duration", label: "Длительность", required: true },
        { key: "imageUrl", label: "Изображение · URL", nullable: true },
        { key: "demoVideoUrl", label: "Демоурок · URL", nullable: true },
        {
          key: "demoFileId",
          label: "Демоурок · Telegram video file_id",
          nullable: true,
        },
        {
          key: "telegramChannelId",
          label: "Telegram Channel ID (-100…)",
          nullable: true,
        },
        { key: "priceKZT", label: "Цена KZT", type: "number", required: true },
        { key: "priceRUB", label: "Цена RUB", type: "number", required: true },
      ];
    if (section === "categories")
      return [
        { key: "title", label: "Название", required: true },
        { key: "slug", label: "Slug", required: true },
        { key: "sortOrder", label: "Порядок", type: "number" },
        { key: "active", label: "Включено", type: "checkbox" },
      ];
    if (section === "recommendations")
      return [
        {
          key: "experienceLevel",
          label: "Опыт",
          type: "select",
          options: options([
            "BEGINNER",
            "PRACTICING",
            "PROFESSIONAL",
            "UPSKILLING",
          ]),
          nullable: true,
        },
        {
          key: "categoryId",
          label: "Направление",
          type: "select",
          options: lookupOptions("categories"),
          nullable: true,
        },
        {
          key: "learningGoal",
          label: "Цель",
          type: "select",
          options: options([
            "NEW_PROFESSION",
            "NEW_SERVICE",
            "PERSONAL",
            "UPSKILLING",
          ]),
          nullable: true,
        },
        {
          key: "matchMode",
          label: "Условия · ALL = все / ANY = любое",
          type: "select",
          options: options(["ALL", "ANY"]),
        },
        {
          key: "courseId",
          label: "Рекомендовать курс",
          type: "select",
          options: lookupOptions("courses"),
          required: true,
        },
        { key: "priority", label: "Приоритет", type: "number" },
        { key: "active", label: "Включено", type: "checkbox" },
      ];
    if (section === "admins")
      return [
        { key: "name", label: "Имя", required: true },
        { key: "email", label: "Email", nullable: true },
        { key: "telegramId", label: "Telegram ID", nullable: true },
        {
          key: "password",
          label: "Пароль · от 12 символов (пусто = оставить)",
          type: "password",
        },
        {
          key: "role",
          label: "Роль",
          type: "select",
          options: options(["ADMIN", "MANAGER"]),
        },
        { key: "active", label: "Активен", type: "checkbox" },
      ];
    if (section === "clients")
      return [
        { key: "firstName", label: "Имя", required: true },
        { key: "lastName", label: "Фамилия", nullable: true },
        { key: "phone", label: "Телефон", nullable: true },
        {
          key: "currentFunnelStage",
          label: "Этап",
          type: "select",
          options: options(stages),
        },
      ];
    if (section === "requests")
      return [
        {
          key: "status",
          label: "Статус",
          type: "select",
          options: options(["NEW", "IN_PROGRESS", "RESOLVED"]),
        },
        {
          key: "assignedTo",
          label: "Ответственный",
          type: "select",
          options: lookupOptions("admins"),
          nullable: true,
        },
        {
          key: "message",
          label: "Сообщение",
          type: "textarea",
          required: true,
        },
      ];
    if (settingKey === "bot")
      return [
        { key: "adminChatId", label: "Admin notification chat ID" },
        {
          key: "helpText",
          label: "Текст помощи",
          type: "textarea",
          required: true,
        },
      ];
    if (settingKey === "reminders")
      return [
        { key: "enabled", label: "Напоминания включены", type: "checkbox" },
        { key: "demoHours", label: "После демо · часы", type: "number" },
        {
          key: "paymentHours",
          label: "После начала оплаты · часы",
          type: "number",
        },
      ];
    return [
      { key: "enabled", label: "Оплата включена", type: "checkbox" },
      { key: "title", label: "Название способа", required: true },
      { key: "instruction", label: "Инструкция", type: "textarea" },
      { key: "requisites", label: "Реквизиты", type: "textarea" },
    ];
  }
  function edit(row: Row = {}, key = "") {
    setSettingKey(key);
    setEditing(row);
    setDraft({
      active: true,
      sortOrder: 0,
      priority: 0,
      matchMode: "ALL",
      status: "DRAFT",
      role: "MANAGER",
      ...row,
      password: "",
    });
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const values: Row = {};
      fields().forEach((field) => {
        const value = draft[field.key];
        values[field.key] =
          field.type === "number"
            ? Number(value ?? 0)
            : field.type === "checkbox"
              ? Boolean(value)
              : field.nullable &&
                  (value === "" || value === undefined || value === null)
                ? null
                : (value ?? "");
        if (field.key === "password" && !value) delete values[field.key];
      });
      await api(`/api/admin/${section}`, {
        method: "POST",
        body: JSON.stringify(
          section === "settings"
            ? { data: { key: settingKey, value: values } }
            : { id: editing?.id, data: values },
        ),
      });
      setEditing(null);
      setNotice("Изменения сохранены");
      await load();
      const updated = await api("/api/admin/lookups");
      setLookups(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  const canEdit = isAdmin || ["clients", "requests"].includes(section);
  const canCreate =
    isAdmin &&
    ["courses", "categories", "recommendations", "admins"].includes(section);
  const filters =
    section === "clients"
      ? stages
      : section === "payments"
        ? [
            "PENDING",
            "PENDING_REVIEW",
            "PAID",
            "REJECTED",
            "CANCELLED",
            "REFUNDED",
          ]
        : section === "courses"
          ? ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]
          : section === "requests"
            ? ["NEW", "IN_PROGRESS", "RESOLVED"]
            : section === "access"
              ? ["WAITING", "CREATING", "GRANTED", "FAILED", "UNCERTAIN"]
              : section === "jobs"
                ? ["PENDING", "RUNNING", "SENT", "FAILED", "CANCELLED"]
                : [];
  const columns =
    section === "clients"
      ? ["Клиент", "Контакт", "Анкета", "Курс / оплата", "Этап", "Регистрация"]
      : section === "courses"
        ? ["Курс", "Направление", "Длительность", "KZT", "RUB", "Статус"]
        : section === "categories"
          ? ["Направление", "Slug", "Порядок", "Включено"]
          : section === "recommendations"
            ? ["Курс", "Опыт", "Направление", "Цель", "Условия", "Приоритет"]
            : section === "payments"
              ? ["Клиент", "Курс", "Сумма", "Способ", "Статус", "Дата"]
              : section === "access"
                ? [
                    "Клиент",
                    "Курс / канал",
                    "Платёж",
                    "Enrollment",
                    "Доступ",
                    "Дата",
                  ]
                : section === "requests"
                  ? [
                      "Клиент",
                      "Курс",
                      "Сообщение",
                      "Статус",
                      "Ответственный",
                      "Дата",
                    ]
                  : section === "admins"
                    ? ["Сотрудник", "Email", "Telegram ID", "Роль", "Активен"]
                    : section === "audit"
                      ? ["Сотрудник", "Действие", "Объект", "ID", "Дата"]
                      : [
                          "Тип",
                          "Объект",
                          "Статус",
                          "Попытки",
                          "Ошибка",
                          "Дата",
                        ];
  function cells(row: Row): React.ReactNode[] {
    if (section === "clients")
      return [
        <Link
          key="client"
          className="font-semibold text-primary"
          href={`/admin/clients/${row.id}`}
        >
          {str(row.firstName)}{" "}
          {str(row.lastName) === "—" ? "" : str(row.lastName)}
          <div className="text-slate-400 font-normal mt-1">
            {row.telegramUsername
              ? `@${row.telegramUsername}`
              : str(row.telegramId)}
          </div>
        </Link>,
        str(row.phone),
        `${str(row.experienceLevel)} · ${name(row.category)} · ${str(row.learningGoal)}`,
        <span key="course">
          {name(row.selectedCourse)}
          <div className="text-xs text-slate-500 mt-1">
            {str(rows(row.payments)[0]?.status)}
          </div>
        </span>,
        <Badge key="stage">{str(row.currentFunnelStage)}</Badge>,
        dt(row.createdAt),
      ];
    if (section === "courses")
      return [
        <span key="title" className="font-semibold">
          {str(row.title)}
          <div className="text-slate-400 text-xs mt-1">{str(row.slug)}</div>
        </span>,
        name(row.category),
        str(row.duration),
        str(row.priceKZT),
        str(row.priceRUB),
        <Badge key="status">{str(row.status)}</Badge>,
      ];
    if (section === "categories")
      return [
        str(row.title),
        str(row.slug),
        str(row.sortOrder),
        row.active ? "Да" : "Нет",
      ];
    if (section === "recommendations")
      return [
        name(row.course),
        str(row.experienceLevel),
        name(row.category),
        str(row.learningGoal),
        str(row.matchMode),
        str(row.priority),
      ];
    if (section === "payments")
      return [
        name(row.user),
        name(row.course),
        `${str(row.amount)} ${str(row.currency)}`,
        str(row.paymentMethod),
        <Badge key="status">{str(row.status)}</Badge>,
        dt(row.createdAt),
      ];
    if (section === "access")
      return [
        name(row.user),
        <span key="course">
          {name(row.course)}
          <div className="text-xs text-slate-400">
            {str(object(row.course).telegramChannelId)}
          </div>
        </span>,
        str(object(row.payment).status),
        str(row.status),
        <span key="access">
          <Badge>{str(row.accessStatus)}</Badge>
          <p className="text-xs text-red-700 mt-1 max-w-56">
            {row.accessError ? str(row.accessError) : ""}
          </p>
          {row.telegramInviteLink ? (
            <a
              className="text-primary text-xs"
              href={str(row.telegramInviteLink)}
              target="_blank"
              rel="noreferrer"
            >
              Открыть приглашение
            </a>
          ) : null}
        </span>,
        dt(row.accessGrantedAt || row.createdAt),
      ];
    if (section === "requests")
      return [
        name(row.user),
        name(row.course),
        <span className="max-w-80 block whitespace-pre-wrap" key="message">
          {str(row.message)}
        </span>,
        <Badge key="status">{str(row.status)}</Badge>,
        name(row.assignee),
        dt(row.createdAt),
      ];
    if (section === "admins")
      return [
        str(row.name),
        str(row.email),
        str(row.telegramId),
        str(row.role),
        row.active ? "Да" : "Нет",
      ];
    if (section === "audit")
      return [
        name(row.admin),
        str(row.action),
        str(row.entity),
        str(row.entityId),
        dt(row.createdAt),
      ];
    return [
      str(row.type),
      str(row.entityId),
      str(row.status),
      str(row.attempts),
      row.lastError ? str(row.lastError) : "—",
      dt(row.createdAt),
    ];
  }
  function paymentActions(row: Row) {
    return (
      <div className="flex flex-wrap gap-2">
        {row.receiptFileId ? (
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/admin/receipts/${row.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Скачать чек
            </a>
          </Button>
        ) : null}
        {row.status === "PENDING_REVIEW" && isAdmin ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(
                  "approve",
                  str(row.id),
                  undefined,
                  false,
                  Number(row.receiptRevision),
                )
              }
            >
              <Check size={14} />
              Подтвердить
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(
                  "Причина отклонения",
                  "Проверьте чек или свяжитесь с менеджером.",
                );
                if (reason !== null)
                  void action(
                    "reject",
                    str(row.id),
                    reason,
                    false,
                    Number(row.receiptRevision),
                  );
              }}
            >
              Отклонить
            </Button>
          </>
        ) : null}
      </div>
    );
  }
  const dashboardView = (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {[
          ["Всего клиентов", data.clients],
          ["Новые за 7 дней", data.newClients],
          [
            "Завершили анкету",
            data.funnel?.find((x) => x.type === "questionnaire_completed")
              ?.count,
          ],
          [
            "Посмотрели демо",
            data.funnel?.find((x) => x.type === "demo_viewed")?.count,
          ],
          [
            "Начали оплату",
            data.funnel?.find((x) => x.type === "payment_started")?.count,
          ],
          ["Ожидают проверки", data.pendingReview],
          [
            "Оплатили",
            data.funnel?.find((x) => x.type === "payment_confirmed")?.count,
          ],
          ["Выдать доступ", data.accessFailed],
          ["Запросы менеджеру", data.managerRequests],
        ].map(([label, value]) => (
          <Card key={str(label)}>
            <CardContent>
              <p className="text-xs text-slate-500 mb-3">{str(label)}</p>
              <p className="text-3xl font-semibold tracking-tight">
                {str(value ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        <Card className="lg:col-span-2">
          <CardContent>
            <h2 className="font-semibold mb-5">
              Воронка продаж{" "}
              <span className="text-xs text-slate-400 font-normal ml-2">
                Уникальные клиенты · всё время
              </span>
            </h2>
            <div className="space-y-3">
              {data.funnel?.map((step, index) => (
                <div
                  key={step.type}
                  className="grid grid-cols-[150px_1fr_80px] gap-4 items-center text-sm"
                >
                  <span className="text-slate-500">{step.label}</span>
                  <div className="bg-slate-100 rounded h-6">
                    <div
                      className="bg-primary/80 rounded h-full min-w-0"
                      style={{
                        width: `${data.funnel?.[0]?.count ? Math.min(100, (step.count / data.funnel[0].count) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-right font-semibold">
                    {step.count}
                    <span className="block text-xs text-slate-400 font-normal">
                      {index && step.conversion !== null
                        ? `${step.conversion}%`
                        : "—"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-6">
              Подтверждённая выручка
            </p>
            {["KZT", "RUB"].map((unit) => (
              <div key={unit} className="mb-7">
                <p className="text-xs text-slate-500 mb-2">{unit}</p>
                <p className="text-3xl font-semibold">
                  {Number(
                    data.revenue?.find((x) => x.currency === unit)?._sum
                      .amount || 0,
                  ).toLocaleString("ru-RU")}
                </p>
              </div>
            ))}
            <p className="text-xs text-slate-400">
              Валюты учитываются отдельно. Только подтверждённые платежи.
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent>
          <div className="flex justify-between mb-4">
            <h2 className="font-semibold">Оплаты на проверке</h2>
            <Link
              className="text-sm text-primary flex gap-1 items-center"
              href="/admin/payments"
            >
              Все оплаты
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {data.recentPayments?.length ? (
            data.recentPayments.map((row) => (
              <div
                key={str(row.id)}
                className="border-t py-4 flex flex-wrap items-center gap-4 justify-between"
              >
                <div>
                  <p className="font-medium">
                    {name(row.user)} · {name(row.course)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {str(row.amount)} {str(row.currency)} · {dt(row.createdAt)}
                  </p>
                </div>
                {paymentActions(row)}
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400 py-6">
              Нет оплат, ожидающих проверки
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
  return (
    <div className="admin-shell flex min-h-screen">
      <aside className="admin-sidebar fixed w-60 min-h-screen bg-[#142c39] text-white">
        <div className="brand px-6 py-8 flex gap-3 items-center">
          <div className="bg-[#2d7a6f] p-2 rounded-lg">
            <GraduationCap size={23} />
          </div>
          <div>
            <p className="font-semibold tracking-wide">Course Sales</p>
            <p className="text-xs text-slate-400 mt-1">Панель управления</p>
          </div>
        </div>
        <nav className="px-3 space-y-1">
          {nav
            .filter(
              (entry) =>
                isAdmin ||
                !["access", "settings", "admins", "audit", "jobs"].includes(
                  entry[0],
                ),
            )
            .map(([key, label, Icon]) => (
              <Link
                key={key}
                href={key === "dashboard" ? "/admin" : `/admin/${key}`}
                className={`sidebar-link ${section === key ? "active" : ""}`}
              >
                <Icon size={17} />
                {label}
              </Link>
            ))}
        </nav>
        <div className="px-6 py-7 mt-6 text-xs text-slate-400">
          Telegram · PostgreSQL
          <br />
          <span className="text-slate-500">Ручное подтверждение оплаты</span>
        </div>
      </aside>
      <main className="admin-content ml-60 w-full p-8 lg:p-10">
        <header className="flex justify-between items-start gap-4 mb-9">
          <div>
            <p className="text-xs text-slate-400 mb-2">УПРАВЛЕНИЕ ОБУЧЕНИЕМ</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {detailId ? "Карточка клиента" : title}
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              {section === "dashboard"
                ? "Клиенты, продажи и доступы — актуальные данные системы."
                : "Все изменения сохраняются в базе данных."}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{admin.name}</p>
            <p className="text-xs text-slate-400 mt-1">{admin.role}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1"
              onClick={() =>
                void api("/api/auth/logout", { method: "POST" }).then(() =>
                  window.location.replace(
                    new URL("/login", window.location.origin).href,
                  ),
                )
              }
            >
              <LogOut size={13} />
              Выйти
            </Button>
          </div>
        </header>
        {error && (
          <div
            role="alert"
            className="mb-4 p-4 bg-red-50 text-red-800 rounded-lg text-sm"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mb-4 flex justify-between p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm"
          >
            {notice}
            <button
              aria-label="Скрыть уведомление"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="py-16 flex justify-center text-slate-400">
            <LoaderCircle className="animate-spin" />
          </div>
        ) : error &&
          !data.items &&
          !data.funnel &&
          !data.settings &&
          !detail ? (
          <Button variant="outline" onClick={() => void load()}>
            Повторить загрузку
          </Button>
        ) : detailId && detail ? (
          <ClientDetail detail={detail} onEdit={() => edit(detail)} />
        ) : ["dashboard", "funnel"].includes(section) ? (
          dashboardView
        ) : section === "settings" ? (
          <div className="grid lg:grid-cols-2 gap-5">
            <Card>
              <CardContent>
                <h2 className="font-semibold mb-5">Telegram</h2>
                {Object.entries(data.telegram || {}).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex justify-between gap-5 border-b py-3 text-sm"
                  >
                    <span className="text-slate-500">{key}</span>
                    <span className="text-right break-all">
                      {typeof value === "object" && value
                        ? str(object(value).message)
                        : str(value)}
                    </span>
                  </div>
                ))}
                <Button
                  className="mt-5"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action("telegram-test")}
                >
                  Проверить соединение
                </Button>
              </CardContent>
            </Card>
            {data.settings?.map((setting) => (
              <Card key={setting.key}>
                <CardContent>
                  <div className="flex justify-between">
                    <h2 className="font-semibold">
                      {{
                        "payment.KZ": "Оплата · Казахстан",
                        "payment.RU": "Оплата · Россия",
                        bot: "Настройки бота",
                        reminders: "Напоминания",
                      }[setting.key] || setting.key}
                    </h2>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => edit(setting.value, setting.key)}
                    >
                      Изменить
                    </Button>
                  </div>
                  {Object.entries(setting.value).map(([key, value]) => (
                    <div key={key} className="border-b py-3 text-sm">
                      <p className="text-slate-400 text-xs mb-1">{key}</p>
                      <p className="whitespace-pre-wrap">
                        {typeof value === "boolean"
                          ? value
                            ? "Да"
                            : "Нет"
                          : str(value) || "Не заполнено"}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 mb-5">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setPage(1);
                  setSearch(query);
                }}
              >
                <Input
                  aria-label="Поиск"
                  placeholder="Поиск клиентов или курсов…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="icon"
                  aria-label="Найти"
                >
                  <Search size={16} />
                </Button>
              </form>
              {filters.length ? (
                <select
                  className="w-auto"
                  aria-label="Фильтр по статусу"
                  value={status}
                  onChange={(e) => {
                    setPage(1);
                    setStatus(e.target.value);
                  }}
                >
                  <option value="">Все статусы</option>
                  {filters.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              ) : null}
              {section === "payments" ? (
                <>
                  <select
                    className="w-auto"
                    aria-label="Валюта"
                    value={currency}
                    onChange={(e) => {
                      setPage(1);
                      setCurrency(e.target.value);
                    }}
                  >
                    <option value="">Все валюты</option>
                    <option>KZT</option>
                    <option>RUB</option>
                  </select>
                  <select
                    className="w-auto max-w-64"
                    aria-label="Курс"
                    value={course}
                    onChange={(e) => {
                      setPage(1);
                      setCourse(e.target.value);
                    }}
                  >
                    <option value="">Все курсы</option>
                    {lookupOptions("courses").map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="date"
                    aria-label="Дата платежа"
                    className="w-auto"
                    value={date}
                    onChange={(e) => {
                      setPage(1);
                      setDate(e.target.value);
                    }}
                  />
                </>
              ) : null}
              <Button
                variant="outline"
                size="icon"
                aria-label="Обновить"
                onClick={() => void load()}
              >
                <RefreshCw size={16} />
              </Button>
              {canCreate ? (
                <Button className="ml-auto" onClick={() => edit()}>
                  <Plus size={16} />
                  Добавить
                </Button>
              ) : null}
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      {columns.map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items?.map((row) => (
                      <tr key={str(row.id)}>
                        {cells(row).map((cell, index) => (
                          <td key={index}>{cell}</td>
                        ))}
                        <td>
                          <div className="flex flex-wrap gap-2">
                            {section === "payments" ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    void api(`/api/admin/payments?id=${row.id}`)
                                      .then((result) => setDetail(result))
                                      .catch((err) => setError(err.message))
                                  }
                                >
                                  Открыть
                                </Button>
                                {paymentActions(row)}
                              </>
                            ) : null}
                            {canEdit &&
                            [
                              "courses",
                              "categories",
                              "recommendations",
                              "admins",
                              "clients",
                              "requests",
                            ].includes(section) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => edit(row)}
                              >
                                Изменить
                              </Button>
                            ) : null}
                            {section === "access" &&
                            isAdmin &&
                            row.accessStatus !== "CREATING" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    row.accessStatus === "UNCERTAIN" &&
                                    !window.confirm(
                                      "Вы проверили ссылки в Telegram и отозвали возможное незаписанное приглашение?",
                                    )
                                  )
                                    return;
                                  void action(
                                    "retry",
                                    str(row.id),
                                    undefined,
                                    row.accessStatus === "UNCERTAIN",
                                  );
                                }}
                              >
                                Повторить выдачу
                              </Button>
                            ) : null}
                            {section === "jobs" && row.status === "FAILED" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void action("job-retry", str(row.id))
                                }
                              >
                                Повторить
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.items?.length ? (
                  <p className="p-12 text-center text-sm text-slate-400">
                    Записей пока нет
                  </p>
                ) : null}
              </div>
              <div className="p-4 flex items-center justify-between text-xs text-slate-400">
                <span>
                  Всего: {data.total || 0} · страница {page}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page * 25 >= (data.total || 0)}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            </Card>
          </>
        )}
      </main>
      {detail && !detailId && section === "payments" ? (
        <div className="modal">
          <div className="modal-content">
            <div className="flex justify-between mb-6">
              <h2 className="text-xl font-semibold">Платёж</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Закрыть"
                onClick={() => setDetail(null)}
              >
                <X />
              </Button>
            </div>
            <p className="font-medium">
              {name(detail.user)} · {name(detail.course)}
            </p>
            <p className="my-3">
              {str(detail.amount)} {str(detail.currency)} ·{" "}
              {str(detail.country)} · {str(detail.paymentMethod)}
            </p>
            <p className="mb-4">
              <Badge>{str(detail.status)}</Badge> · {dt(detail.createdAt)}
            </p>
            <p className="text-sm mb-5">
              {detail.rejectionReason ? str(detail.rejectionReason) : ""}
            </p>
            {paymentActions(detail)}
            <h3 className="mt-6 mb-3 font-semibold">История проверки</h3>
            {rows(detail.history).map((row) => (
              <p key={str(row.id)} className="text-sm border-t py-3">
                {str(row.action)} · {name(row.admin)} · {dt(row.createdAt)}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {editing ? (
        <div className="modal">
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
          >
            <div className="flex justify-between mb-6">
              <h2 id="editor-title" className="text-xl font-semibold">
                {editing.id
                  ? "Изменить запись"
                  : settingKey
                    ? "Настройки"
                    : "Новая запись"}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Закрыть"
                onClick={() => setEditing(null)}
              >
                <X />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="grid md:grid-cols-2 gap-5">
                {fields().map((field) => (
                  <label
                    key={field.key}
                    className={`block text-sm ${field.type === "textarea" ? "md:col-span-2" : ""}`}
                  >
                    {field.type !== "checkbox" && (
                      <span className="block mb-2 text-slate-600">
                        {field.label}
                      </span>
                    )}
                    {field.type === "checkbox" ? (
                      <span className="flex gap-3 items-center pt-7">
                        <input
                          type="checkbox"
                          checked={Boolean(draft[field.key])}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [field.key]: e.target.checked,
                            })
                          }
                        />
                        {field.label}
                      </span>
                    ) : field.type === "select" ? (
                      <select
                        required={field.required}
                        value={
                          draft[field.key] === null ||
                          draft[field.key] === undefined
                            ? ""
                            : str(draft[field.key])
                        }
                        onChange={(e) =>
                          setDraft({ ...draft, [field.key]: e.target.value })
                        }
                      >
                        <option value="">
                          {field.nullable ? "Любое / не задано" : "Выберите"}
                        </option>
                        {field.options?.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        required={field.required}
                        value={str(draft[field.key] ?? "")}
                        onChange={(e) =>
                          setDraft({ ...draft, [field.key]: e.target.value })
                        }
                      />
                    ) : (
                      <Input
                        required={field.required}
                        type={
                          field.type === "number"
                            ? "number"
                            : field.type === "password"
                              ? "password"
                              : "text"
                        }
                        step={field.type === "number" ? "0.01" : undefined}
                        value={str(draft[field.key] ?? "")}
                        onChange={(e) =>
                          setDraft({ ...draft, [field.key]: e.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              {error ? (
                <p role="alert" className="text-red-700 text-sm mt-5">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-3 mt-7">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Отмена
                </Button>
                <Button disabled={busy}>
                  {busy ? "Сохраняем…" : "Сохранить"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
function ClientDetail({ detail, onEdit }: { detail: Row; onEdit: () => void }) {
  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <Card>
        <CardContent>
          <div className="flex justify-between mb-4">
            <h2 className="font-semibold">Клиент</h2>
            <Button size="sm" variant="outline" onClick={onEdit}>
              Изменить
            </Button>
          </div>
          <p className="text-xl font-semibold mb-5">
            {str(detail.firstName)}{" "}
            {str(detail.lastName) === "—" ? "" : str(detail.lastName)}
          </p>
          {[
            ["Telegram ID", detail.telegramId],
            ["Username", detail.telegramUsername],
            ["Телефон", detail.phone],
            ["Регистрация", dt(detail.createdAt)],
            ["Опыт", detail.experienceLevel],
            ["Направление", name(detail.category)],
            ["Цель", detail.learningGoal],
            ["Этап", detail.currentFunnelStage],
            ["Выбранный курс", name(detail.selectedCourse)],
          ].map(([label, value]) => (
            <div key={str(label)} className="border-t py-3 text-sm">
              <p className="text-xs text-slate-400 mb-1">{str(label)}</p>
              {str(value)}
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="lg:col-span-2 space-y-5">
        {[
          ["recommendations", "Рекомендованные курсы"],
          ["payments", "Оплаты"],
          ["enrollments", "Приобретённые курсы / доступы"],
          ["managerRequests", "Запросы менеджеру"],
        ].map(([key, label]) => (
          <Card key={key}>
            <CardContent>
              <h2 className="font-semibold mb-4">{label}</h2>
              {rows(detail[key]).length ? (
                rows(detail[key]).map((row) => (
                  <div
                    key={str(row.id)}
                    className="border-t py-3 text-sm flex flex-wrap gap-3 justify-between"
                  >
                    <span>
                      {row.course ? name(row.course) : str(row.message)}
                    </span>
                    <span>
                      {str(row.status || row.accessStatus || "Рекомендован")}
                      {row.amount
                        ? ` · ${row.amount} ${row.currency}`
                        : ""} · {dt(row.createdAt)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">Нет записей</p>
              )}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent>
            <h2 className="font-semibold mb-4">Timeline · история событий</h2>
            {rows(detail.events).map((row) => (
              <div
                key={str(row.id)}
                className="border-l-2 border-emerald-100 pl-4 pb-5"
              >
                <p className="text-sm font-medium">{str(row.type)}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {dt(row.createdAt)}
                </p>
                <p className="text-xs text-slate-500 mt-2 break-all">
                  {JSON.stringify(row.metadata)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
