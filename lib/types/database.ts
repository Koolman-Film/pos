export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  pos: {
    Tables: {
      app_users: {
        Row: {
          active: boolean
          email: string
          id: string
          name: string
          role_id: string
          sees_all_shops: boolean
        }
        Insert: {
          active?: boolean
          email: string
          id: string
          name: string
          role_id: string
          sees_all_shops?: boolean
        }
        Update: {
          active?: boolean
          email?: string
          id?: string
          name?: string
          role_id?: string
          sees_all_shops?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "app_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      car_models: {
        Row: {
          brand: string
          car_type: string
          id: number
          model: string
        }
        Insert: {
          brand: string
          car_type: string
          id?: never
          model: string
        }
        Update: {
          brand?: string
          car_type?: string
          id?: never
          model?: string
        }
        Relationships: []
      }
      commission_rule_teams: {
        Row: {
          commission_rule_id: number
          team_member: string
        }
        Insert: {
          commission_rule_id: number
          team_member: string
        }
        Update: {
          commission_rule_id?: number
          team_member?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_rule_teams_commission_rule_id_fkey"
            columns: ["commission_rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          active: boolean
          category: string
          id: number
          name: string
          shop_id: string | null
          type: string
          value: number
        }
        Insert: {
          active?: boolean
          category: string
          id?: never
          name: string
          shop_id?: string | null
          type: string
          value: number
        }
        Update: {
          active?: boolean
          category?: string
          id?: never
          name?: string
          shop_id?: string | null
          type?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_buyers: {
        Row: {
          address: string
          id: number
          name: string
          tax_id: string
        }
        Insert: {
          address?: string
          id?: never
          name: string
          tax_id?: string
        }
        Update: {
          address?: string
          id?: never
          name?: string
          tax_id?: string
        }
        Relationships: []
      }
      expense_attachments: {
        Row: {
          expense_id: number
          file_name: string
          id: number
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          expense_id: number
          file_name: string
          id?: never
          mime_type?: string
          size_bytes?: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          expense_id?: number
          file_name?: string
          id?: never
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_attachments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          description: string
          due_at: string | null
          id: number
          paid_at: string | null
          shop_id: string
          source: string
          status: string
        }
        Insert: {
          amount: number
          category: string
          description: string
          due_at?: string | null
          id?: never
          paid_at?: string | null
          shop_id: string
          source: string
          status: string
        }
        Update: {
          amount?: number
          category?: string
          description?: string
          due_at?: string | null
          id?: never
          paid_at?: string | null
          shop_id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      film_price_matrix: {
        Row: {
          car_type: string
          category: string
          id: number
          position: string
          price: number
          product: string
        }
        Insert: {
          car_type: string
          category: string
          id?: never
          position: string
          price: number
          product: string
        }
        Update: {
          car_type?: string
          category?: string
          id?: never
          position?: string
          price?: number
          product?: string
        }
        Relationships: []
      }
      option_lists: {
        Row: {
          id: number
          list_key: string
          shop_id: string | null
          sort_order: number
          value: string
        }
        Insert: {
          id?: never
          list_key: string
          shop_id?: string | null
          sort_order?: number
          value: string
        }
        Update: {
          id?: never
          list_key?: string
          shop_id?: string | null
          sort_order?: number
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_lists_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      order_adjustments: {
        Row: {
          adjusted_at: string
          amount: number
          id: number
          order_id: string
          reason: string
        }
        Insert: {
          adjusted_at: string
          amount: number
          id?: never
          order_id: string
          reason?: string
        }
        Update: {
          adjusted_at?: string
          amount?: number
          id?: never
          order_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: number
          list_price: number
          name: string
          order_id: string
          qty: number
          reason: string
          requested_price: number
        }
        Insert: {
          id?: never
          list_price: number
          name: string
          order_id: string
          qty: number
          reason?: string
          requested_price: number
        }
        Update: {
          id?: never
          list_price?: number
          name?: string
          order_id?: string
          qty?: number
          reason?: string
          requested_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payments: {
        Row: {
          amount: number
          id: number
          method: string
          order_id: string
          paid_at: string
        }
        Insert: {
          amount: number
          id?: never
          method: string
          order_id: string
          paid_at: string
        }
        Update: {
          amount?: number
          id?: never
          method?: string
          order_id?: string
          paid_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_returns: {
        Row: {
          id: number
          item_name: string
          order_id: string
          qty: number
          reason: string
        }
        Insert: {
          id?: never
          item_name: string
          order_id: string
          qty: number
          reason?: string
        }
        Update: {
          id?: never
          item_name?: string
          order_id?: string
          qty?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          customer_id: number | null
          id: string
          shop_id: string
          status: string
        }
        Insert: {
          created_at?: string
          customer_id?: number | null
          id: string
          shop_id: string
          status: string
        }
        Update: {
          created_at?: string
          customer_id?: number | null
          id?: string
          shop_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "wholesale_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_status_fkey"
            columns: ["status"]
            isOneToOne: false
            referencedRelation: "ws_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      petty_cash: {
        Row: {
          amount: number
          entry_at: string
          id: number
          note: string
          shop_id: string
          type: string
        }
        Insert: {
          amount: number
          entry_at: string
          id?: never
          note?: string
          shop_id: string
          type: string
        }
        Update: {
          amount?: number
          entry_at?: string
          id?: never
          note?: string
          shop_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      price_matrix: {
        Row: {
          car_type: string
          id: number
          price: number
          product: string
        }
        Insert: {
          car_type: string
          id?: never
          price: number
          product: string
        }
        Update: {
          car_type?: string
          id?: never
          price?: number
          product?: string
        }
        Relationships: []
      }
      retail_customers: {
        Row: {
          id: number
          name: string
          phone: string
        }
        Insert: {
          id?: never
          name: string
          phone?: string
        }
        Update: {
          id?: never
          name?: string
          phone?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          allowed: boolean
          permission_key: string
          permission_type: Database["pos"]["Enums"]["permission_type"]
          role_id: string
        }
        Insert: {
          allowed?: boolean
          permission_key: string
          permission_type: Database["pos"]["Enums"]["permission_type"]
          role_id: string
        }
        Update: {
          allowed?: boolean
          permission_key?: string
          permission_type?: Database["pos"]["Enums"]["permission_type"]
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          icon: string
          id: string
          name: string
        }
        Insert: {
          icon?: string
          id: string
          name: string
        }
        Update: {
          icon?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      shop_info: {
        Row: {
          address: string
          company_name: string
          payment_channels: string[]
          phone: string
          shop_id: string
          tax_id: string
        }
        Insert: {
          address?: string
          company_name?: string
          payment_channels?: string[]
          phone?: string
          shop_id: string
          tax_id?: string
        }
        Update: {
          address?: string
          company_name?: string
          payment_channels?: string[]
          phone?: string
          shop_id?: string
          tax_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_info_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          id: string
          name: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      statuses: {
        Row: {
          bg: string
          dot: string
          key: string
          short: string
          sort_order: number
          text_color: string
        }
        Insert: {
          bg: string
          dot: string
          key: string
          short: string
          sort_order?: number
          text_color: string
        }
        Update: {
          bg?: string
          dot?: string
          key?: string
          short?: string
          sort_order?: number
          text_color?: string
        }
        Relationships: []
      }
      stock: {
        Row: {
          category: string
          cost: number
          id: number
          min_qty: number
          name: string
          qty: number
          sell_price: number
          shop_id: string
          short_name: string
          sku: string
        }
        Insert: {
          category: string
          cost?: number
          id?: never
          min_qty?: number
          name: string
          qty?: number
          sell_price?: number
          shop_id: string
          short_name?: string
          sku: string
        }
        Update: {
          category?: string
          cost?: number
          id?: never
          min_qty?: number
          name?: string
          qty?: number
          sell_price?: number
          shop_id?: string
          short_name?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_item_positions: {
        Row: {
          id: number
          position: string
          price: number
          product: string
          ticket_item_id: number
        }
        Insert: {
          id?: never
          position: string
          price: number
          product: string
          ticket_item_id: number
        }
        Update: {
          id?: never
          position?: string
          price?: number
          product?: string
          ticket_item_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_item_positions_ticket_item_id_fkey"
            columns: ["ticket_item_id"]
            isOneToOne: false
            referencedRelation: "ticket_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_items: {
        Row: {
          actual_qty: Json
          booked: string
          booked_price: number
          category: string
          discount_type: string | null
          discount_value: number | null
          id: number
          interested: string
          interested_price: number
          sold: string
          sold_price: number
          ticket_id: string
        }
        Insert: {
          actual_qty?: Json
          booked?: string
          booked_price?: number
          category: string
          discount_type?: string | null
          discount_value?: number | null
          id?: never
          interested?: string
          interested_price?: number
          sold?: string
          sold_price?: number
          ticket_id: string
        }
        Update: {
          actual_qty?: Json
          booked?: string
          booked_price?: number
          category?: string
          discount_type?: string | null
          discount_value?: number | null
          id?: never
          interested?: string
          interested_price?: number
          sold?: string
          sold_price?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_payments: {
        Row: {
          amount: number
          attachments: string[]
          id: number
          method: string
          paid_at: string
          ticket_id: string
          type: string
        }
        Insert: {
          amount: number
          attachments?: string[]
          id?: never
          method: string
          paid_at: string
          ticket_id: string
          type: string
        }
        Update: {
          amount?: number
          attachments?: string[]
          id?: never
          method?: string
          paid_at?: string
          ticket_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_payments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_status_history: {
        Row: {
          changed_at: string
          id: number
          status: string
          ticket_id: string
        }
        Insert: {
          changed_at?: string
          id?: never
          status: string
          ticket_id: string
        }
        Update: {
          changed_at?: string
          id?: never
          status?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_status_history_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          booking_channel: string
          brand: string
          car_type: string
          color: string
          created_at: string
          customer_name: string
          deleted_at: string | null
          deleted_by: string | null
          locked: boolean
          drop_off_date: string
          extras: Json
          id: string
          model: string
          phone: string
          pickup_date: string
          plate: string
          retail_customer_id: number | null
          service_type: string
          shop_id: string
          status: string
          tech_by_category: Json
        }
        Insert: {
          booking_channel?: string
          brand?: string
          car_type?: string
          color?: string
          created_at?: string
          customer_name: string
          deleted_at?: string | null
          deleted_by?: string | null
          locked?: boolean
          drop_off_date: string
          extras?: Json
          id: string
          model?: string
          phone?: string
          pickup_date: string
          plate?: string
          retail_customer_id?: number | null
          service_type?: string
          shop_id: string
          status: string
          tech_by_category?: Json
        }
        Update: {
          booking_channel?: string
          brand?: string
          car_type?: string
          color?: string
          created_at?: string
          customer_name?: string
          deleted_at?: string | null
          deleted_by?: string | null
          locked?: boolean
          drop_off_date?: string
          extras?: Json
          id?: string
          model?: string
          phone?: string
          pickup_date?: string
          plate?: string
          retail_customer_id?: number | null
          service_type?: string
          shop_id?: string
          status?: string
          tech_by_category?: Json
        }
        Relationships: [
          {
            foreignKeyName: "tickets_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_retail_customer_id_fkey"
            columns: ["retail_customer_id"]
            isOneToOne: false
            referencedRelation: "retail_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_status_fkey"
            columns: ["status"]
            isOneToOne: false
            referencedRelation: "statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      user_shop_access: {
        Row: {
          shop_id: string
          user_id: string
        }
        Insert: {
          shop_id: string
          user_id: string
        }
        Update: {
          shop_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_shop_access_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_shop_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      wholesale_customers: {
        Row: {
          address: string
          id: number
          name: string
          phone: string
        }
        Insert: {
          address?: string
          id?: never
          name: string
          phone?: string
        }
        Update: {
          address?: string
          id?: never
          name?: string
          phone?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          id: number
          item: string
          qty: number
          shop_id: string
          status: string
          type: string
          withdrawn_at: string
          withdrawn_by: string
        }
        Insert: {
          id?: never
          item: string
          qty: number
          shop_id: string
          status?: string
          type: string
          withdrawn_at: string
          withdrawn_by: string
        }
        Update: {
          id?: never
          item?: string
          qty?: number
          shop_id?: string
          status?: string
          type?: string
          withdrawn_at?: string
          withdrawn_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      ws_statuses: {
        Row: {
          bg: string
          dot: string
          key: string
          sort_order: number
          text_color: string
        }
        Insert: {
          bg: string
          dot: string
          key: string
          sort_order?: number
          text_color: string
        }
        Update: {
          bg?: string
          dot?: string
          key?: string
          sort_order?: number
          text_color?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_can: { Args: { cap: string }; Returns: boolean }
      current_user_has_nav: { Args: { nav_key: string }; Returns: boolean }
      current_user_role: { Args: never; Returns: string }
      current_user_sees_all_shops: { Args: never; Returns: boolean }
      current_user_shops: { Args: never; Returns: string[] }
      reset_permissions_to_defaults: { Args: never; Returns: undefined }
      save_order_children: {
        Args: {
          p_adjustments: Json
          p_items: Json
          p_order_id: string
          p_payments: Json
          p_returns: Json
          p_saved_on: string
        }
        Returns: undefined
      }
      save_ticket_children: {
        Args: { p_items: Json; p_payments: Json; p_ticket_id: string }
        Returns: undefined
      }
    }
    Enums: {
      permission_type: "nav" | "dashboard_widget" | "module_capability"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  pos: {
    Enums: {
      permission_type: ["nav", "dashboard_widget", "module_capability"],
    },
  },
} as const

