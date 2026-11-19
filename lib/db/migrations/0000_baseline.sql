-- Schema as of PR 23 (18 Nov 2026). Production already has it; the runner records it as applied there.

-- Name: admin_invitations; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.admin_invitations (
    id integer NOT NULL,
    token_hash text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    user_limit integer DEFAULT 15 NOT NULL,
    invited_by_admin_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Name: admin_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.admin_invitations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: admin_invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.admin_invitations_id_seq OWNED BY public.admin_invitations.id;

-- Name: audit_log; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    actor_id integer NOT NULL,
    actor_email text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id integer,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_ip text,
    business_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

-- Name: businesses; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.businesses (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    gstin text,
    pan text,
    address text,
    city text,
    state text,
    state_code text,
    pincode text,
    phone text,
    email text,
    website text,
    logo_url text,
    invoice_prefix text DEFAULT 'INV'::text,
    bank_name text,
    bank_account text,
    bank_ifsc text,
    bank_branch text,
    upi_id text,
    terms_conditions text,
    lock_date text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: businesses_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.businesses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: businesses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.businesses_id_seq OWNED BY public.businesses.id;

-- Name: capacity_requests; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.capacity_requests (
    id integer NOT NULL,
    admin_id integer NOT NULL,
    additional_users integer NOT NULL,
    amount_inr integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by_admin_id integer,
    reviewed_at timestamp with time zone,
    granted_user_limit integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Name: capacity_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.capacity_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: capacity_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.capacity_requests_id_seq OWNED BY public.capacity_requests.id;

-- Name: customers; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.customers (
    id integer NOT NULL,
    business_id integer NOT NULL,
    name text NOT NULL,
    gstin text,
    phone text,
    email text,
    address text,
    city text,
    state text,
    state_code text,
    pincode text,
    credit_limit numeric(15,2),
    outstanding_balance numeric(15,2) DEFAULT '0'::numeric,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;

-- Name: eway_bills; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.eway_bills (
    id integer NOT NULL,
    business_id integer NOT NULL,
    ewb_no text,
    ewb_date text,
    valid_upto text,
    status text DEFAULT 'draft'::text NOT NULL,
    supply_type text DEFAULT 'O'::text NOT NULL,
    sub_supply_type text DEFAULT '1'::text NOT NULL,
    doc_type text DEFAULT 'INV'::text NOT NULL,
    doc_no text NOT NULL,
    doc_date text NOT NULL,
    from_gstin text,
    from_trd_name text,
    from_addr1 text,
    from_city text,
    from_state text,
    from_pincode text,
    to_gstin text,
    to_trd_name text,
    to_addr1 text,
    to_city text,
    to_state text,
    to_pincode text,
    trans_mode text DEFAULT '1'::text NOT NULL,
    trans_distance text,
    transporter_name text,
    transporter_id text,
    trans_doc_no text,
    trans_doc_date text,
    vehicle_no text,
    vehicle_type text DEFAULT 'R'::text NOT NULL,
    total_value numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    cgst_value numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    sgst_value numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    igst_value numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    total_inv_value numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    invoice_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: eway_bills_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.eway_bills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: eway_bills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.eway_bills_id_seq OWNED BY public.eway_bills.id;

-- Name: invoice_counters; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.invoice_counters (
    business_id integer NOT NULL,
    financial_year text NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);

-- Name: invoices; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.invoices (
    id integer NOT NULL,
    business_id integer NOT NULL,
    invoice_number text NOT NULL,
    type text DEFAULT 'Tax Invoice'::text NOT NULL,
    status text DEFAULT 'unpaid'::text NOT NULL,
    customer_id integer NOT NULL,
    customer_name text NOT NULL,
    customer_gstin text,
    invoice_date text NOT NULL,
    due_date text,
    place_of_supply text,
    is_interstate boolean DEFAULT false NOT NULL,
    subtotal numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    cgst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    sgst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    igst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    total_gst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    round_off numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    grand_total numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    paid_amount numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    tcs_rate numeric(5,3) DEFAULT '0'::numeric NOT NULL,
    tcs_amount numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;

-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.login_attempts (
    key text NOT NULL,
    failures integer DEFAULT 0 NOT NULL,
    first_failure_at timestamp without time zone DEFAULT now() NOT NULL,
    locked_until timestamp without time zone
);

-- Name: payments; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.payments (
    id integer NOT NULL,
    business_id integer NOT NULL,
    type text NOT NULL,
    amount numeric(15,2) NOT NULL,
    date text NOT NULL,
    mode text DEFAULT 'cash'::text NOT NULL,
    reference_number text,
    invoice_id integer,
    customer_id integer,
    vendor_id integer,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;

-- Name: pending_registrations; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.pending_registrations (
    id integer NOT NULL,
    token_hash text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    business_name text NOT NULL,
    gstin text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Name: pending_registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.pending_registrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: pending_registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.pending_registrations_id_seq OWNED BY public.pending_registrations.id;

-- Name: products; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.products (
    id integer NOT NULL,
    business_id integer NOT NULL,
    name text NOT NULL,
    sku text,
    hsn_code text,
    unit text DEFAULT 'Nos'::text NOT NULL,
    purchase_price numeric(15,2),
    selling_price numeric(15,2),
    gst_rate numeric(5,2) DEFAULT '18'::numeric NOT NULL,
    stock_quantity numeric(15,3) DEFAULT '0'::numeric NOT NULL,
    low_stock_threshold numeric(15,3),
    description text,
    category text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;

-- Name: purchases; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.purchases (
    id integer NOT NULL,
    business_id integer NOT NULL,
    vendor_id integer NOT NULL,
    vendor_name text NOT NULL,
    vendor_gstin text,
    invoice_number text NOT NULL,
    invoice_date text NOT NULL,
    due_date text,
    is_interstate boolean DEFAULT false NOT NULL,
    status text DEFAULT 'unpaid'::text NOT NULL,
    subtotal numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    cgst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    sgst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    igst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    total_gst numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    grand_total numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    tds_section text,
    tds_rate numeric(5,3) DEFAULT '0'::numeric NOT NULL,
    tds_amount numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.purchases_id_seq OWNED BY public.purchases.id;

-- Name: revoked_tokens; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.revoked_tokens (
    jti text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Name: users; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.users (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    subscription_status text,
    subscription_end text,
    business_id integer,
    created_by_admin_id integer,
    access_level text,
    user_limit integer DEFAULT 15 NOT NULL,
    deleted_at timestamp without time zone,
    token_version integer DEFAULT 0 NOT NULL,
    mfa_secret text,
    mfa_enabled_at timestamp without time zone,
    mfa_last_step integer,
    mfa_recovery_codes text[],
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

-- Name: vendors; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.vendors (
    id integer NOT NULL,
    business_id integer NOT NULL,
    name text NOT NULL,
    gstin text,
    phone text,
    email text,
    address text,
    city text,
    state text,
    state_code text,
    pincode text,
    outstanding_balance numeric(15,2) DEFAULT '0'::numeric,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

-- Name: vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -

CREATE SEQUENCE public.vendors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Name: vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -

ALTER SEQUENCE public.vendors_id_seq OWNED BY public.vendors.id;

-- Name: admin_invitations id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.admin_invitations ALTER COLUMN id SET DEFAULT nextval('public.admin_invitations_id_seq'::regclass);

-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);

-- Name: businesses id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.businesses ALTER COLUMN id SET DEFAULT nextval('public.businesses_id_seq'::regclass);

-- Name: capacity_requests id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.capacity_requests ALTER COLUMN id SET DEFAULT nextval('public.capacity_requests_id_seq'::regclass);

-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);

-- Name: eway_bills id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.eway_bills ALTER COLUMN id SET DEFAULT nextval('public.eway_bills_id_seq'::regclass);

-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);

-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);

-- Name: pending_registrations id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.pending_registrations ALTER COLUMN id SET DEFAULT nextval('public.pending_registrations_id_seq'::regclass);

-- Name: products id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);

-- Name: purchases id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.purchases ALTER COLUMN id SET DEFAULT nextval('public.purchases_id_seq'::regclass);

-- Name: users id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

-- Name: vendors id; Type: DEFAULT; Schema: public; Owner: -

ALTER TABLE ONLY public.vendors ALTER COLUMN id SET DEFAULT nextval('public.vendors_id_seq'::regclass);

-- Name: admin_invitations admin_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.admin_invitations
    ADD CONSTRAINT admin_invitations_pkey PRIMARY KEY (id);

-- Name: admin_invitations admin_invitations_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.admin_invitations
    ADD CONSTRAINT admin_invitations_token_hash_unique UNIQUE (token_hash);

-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

-- Name: businesses businesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.businesses
    ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);

-- Name: capacity_requests capacity_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.capacity_requests
    ADD CONSTRAINT capacity_requests_pkey PRIMARY KEY (id);

-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

-- Name: eway_bills eway_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.eway_bills
    ADD CONSTRAINT eway_bills_pkey PRIMARY KEY (id);

-- Name: invoice_counters invoice_counters_business_id_financial_year_pk; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_business_id_financial_year_pk PRIMARY KEY (business_id, financial_year);

-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);

-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (key);

-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

-- Name: pending_registrations pending_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.pending_registrations
    ADD CONSTRAINT pending_registrations_pkey PRIMARY KEY (id);

-- Name: pending_registrations pending_registrations_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.pending_registrations
    ADD CONSTRAINT pending_registrations_token_hash_unique UNIQUE (token_hash);

-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);

-- Name: revoked_tokens revoked_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.revoked_tokens
    ADD CONSTRAINT revoked_tokens_pkey PRIMARY KEY (jti);

-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);

-- Name: admin_invitations_expires_at_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX admin_invitations_expires_at_idx ON public.admin_invitations USING btree (expires_at);

-- Name: admin_invitations_unused_email_idx; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX admin_invitations_unused_email_idx ON public.admin_invitations USING btree (email) WHERE (used_at IS NULL);

-- Name: audit_log_business_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX audit_log_business_idx ON public.audit_log USING btree (business_id, created_at);

-- Name: capacity_requests_admin_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX capacity_requests_admin_id_idx ON public.capacity_requests USING btree (admin_id);

-- Name: capacity_requests_created_at_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX capacity_requests_created_at_idx ON public.capacity_requests USING btree (created_at);

-- Name: capacity_requests_one_pending_per_admin_idx; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX capacity_requests_one_pending_per_admin_idx ON public.capacity_requests USING btree (admin_id) WHERE (status = 'pending'::text);

-- Name: customers_business_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX customers_business_idx ON public.customers USING btree (business_id);

-- Name: eway_bills_business_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX eway_bills_business_idx ON public.eway_bills USING btree (business_id);

-- Name: invoices_business_number_unique; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX invoices_business_number_unique ON public.invoices USING btree (business_id, invoice_number);

-- Name: payments_business_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX payments_business_idx ON public.payments USING btree (business_id);

-- Name: payments_invoice_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX payments_invoice_idx ON public.payments USING btree (invoice_id);

-- Name: pending_registrations_email_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX pending_registrations_email_idx ON public.pending_registrations USING btree (email);

-- Name: pending_registrations_expires_at_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX pending_registrations_expires_at_idx ON public.pending_registrations USING btree (expires_at);

-- Name: products_business_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX products_business_idx ON public.products USING btree (business_id);

-- Name: purchases_business_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX purchases_business_idx ON public.purchases USING btree (business_id);

-- Name: revoked_tokens_expires_at_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX revoked_tokens_expires_at_idx ON public.revoked_tokens USING btree (expires_at);

-- Name: users_created_by_admin_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX users_created_by_admin_idx ON public.users USING btree (created_by_admin_id);

-- Name: vendors_business_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX vendors_business_idx ON public.vendors USING btree (business_id);

