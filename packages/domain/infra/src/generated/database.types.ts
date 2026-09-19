export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          balance_minor: number
          created_at: string
          credit_limit_minor: number | null
          credit_used_minor: number | null
          currency: string
          deleted_at: string | null
          id: string
          is_archived: boolean
          market_value_minor: number | null
          name: string
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_minor?: number
          created_at?: string
          credit_limit_minor?: number | null
          credit_used_minor?: number | null
          currency: string
          deleted_at?: string | null
          id?: string
          is_archived?: boolean
          market_value_minor?: number | null
          name: string
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_minor?: number
          created_at?: string
          credit_limit_minor?: number | null
          credit_used_minor?: number | null
          currency?: string
          deleted_at?: string | null
          id?: string
          is_archived?: boolean
          market_value_minor?: number | null
          name?: string
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: Json
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_credentials: {
        Row: {
          created_at: string
          deactivated_at: string | null
          encrypted_api_key: string
          id: string
          is_active: boolean
          key_last_four: string
          last_validated_at: string | null
          last_validation_error: string | null
          provider: Database["public"]["Enums"]["ai_provider"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          encrypted_api_key: string
          id?: string
          is_active?: boolean
          key_last_four: string
          last_validated_at?: string | null
          last_validation_error?: string | null
          provider: Database["public"]["Enums"]["ai_provider"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          encrypted_api_key?: string
          id?: string
          is_active?: boolean
          key_last_four?: string
          last_validated_at?: string | null
          last_validation_error?: string | null
          provider?: Database["public"]["Enums"]["ai_provider"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: Database["public"]["Enums"]["audit_actor"]
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          actor: Database["public"]["Enums"]["audit_actor"]
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          actor?: Database["public"]["Enums"]["audit_actor"]
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      bill_definitions: {
        Row: {
          category_id: string | null
          created_at: string
          deleted_at: string | null
          detection_source: string
          expected_amount_minor: number | null
          expected_amount_tolerance_pct: number | null
          id: string
          merchant_pattern: string
          recurrence_interval: Database["public"]["Enums"]["recurrence_interval"]
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          detection_source: string
          expected_amount_minor?: number | null
          expected_amount_tolerance_pct?: number | null
          id?: string
          merchant_pattern: string
          recurrence_interval: Database["public"]["Enums"]["recurrence_interval"]
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          detection_source?: string
          expected_amount_minor?: number | null
          expected_amount_tolerance_pct?: number | null
          id?: string
          merchant_pattern?: string
          recurrence_interval?: Database["public"]["Enums"]["recurrence_interval"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_definitions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_predictions: {
        Row: {
          bill_definition_id: string
          created_at: string
          expected_amount_minor: number | null
          expected_date: string
          id: string
          matched_at: string | null
          matched_transaction_id: string | null
          status: Database["public"]["Enums"]["bill_prediction_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          bill_definition_id: string
          created_at?: string
          expected_amount_minor?: number | null
          expected_date: string
          id?: string
          matched_at?: string | null
          matched_transaction_id?: string | null
          status?: Database["public"]["Enums"]["bill_prediction_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          bill_definition_id?: string
          created_at?: string
          expected_amount_minor?: number | null
          expected_date?: string
          id?: string
          matched_at?: string | null
          matched_transaction_id?: string | null
          status?: Database["public"]["Enums"]["bill_prediction_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_predictions_bill_definition_id_fkey"
            columns: ["bill_definition_id"]
            isOneToOne: false
            referencedRelation: "bill_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_predictions_matched_transaction_fk"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount_minor: number
          category_id: string
          created_at: string
          deleted_at: string | null
          id: string
          is_recurring: boolean
          period_end: string
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          category_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_recurring?: boolean
          period_end: string
          period_start: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          category_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_recurring?: boolean
          period_end?: string
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          archived_at: string | null
          created_at: string
          icon: string | null
          id: string
          is_system: boolean
          name: string
          parent_category_id: string | null
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_system?: boolean
          name: string
          parent_category_id?: string | null
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_system?: boolean
          name?: string
          parent_category_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_connections: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          connected_at: string
          created_at: string
          disconnected_at: string | null
          display_name: string | null
          encrypted_metadata: string | null
          id: string
          status: Database["public"]["Enums"]["channel_connection_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          display_name?: string | null
          encrypted_metadata?: string | null
          id?: string
          status?: Database["public"]["Enums"]["channel_connection_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          display_name?: string | null
          encrypted_metadata?: string | null
          id?: string
          status?: Database["public"]["Enums"]["channel_connection_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_card_payment_sources: {
        Row: {
          created_at: string
          credit_card_account_id: string
          id: string
          payment_account_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credit_card_account_id: string
          id?: string
          payment_account_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credit_card_account_id?: string
          id?: string
          payment_account_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_payment_sources_credit_card_account_id_fkey"
            columns: ["credit_card_account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_payment_sources_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_connections: {
        Row: {
          candidates_found_last_sync: number | null
          connected_at: string
          created_at: string
          encrypted_refresh_token: string | null
          google_email: string
          history_id: string | null
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          revoked_at: string | null
          scopes: string[]
          sync_status: Database["public"]["Enums"]["gmail_sync_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          candidates_found_last_sync?: number | null
          connected_at?: string
          created_at?: string
          encrypted_refresh_token?: string | null
          google_email: string
          history_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          revoked_at?: string | null
          scopes: string[]
          sync_status?: Database["public"]["Enums"]["gmail_sync_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          candidates_found_last_sync?: number | null
          connected_at?: string
          created_at?: string
          encrypted_refresh_token?: string | null
          google_email?: string
          history_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          revoked_at?: string | null
          scopes?: string[]
          sync_status?: Database["public"]["Enums"]["gmail_sync_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gmail_financial_candidates: {
        Row: {
          account_id: string | null
          account_match_required: boolean
          candidate_type: Database["public"]["Enums"]["gmail_candidate_type"]
          confidence_score: number
          created_at: string
          created_transaction_id: string | null
          currency: string | null
          direction: Database["public"]["Enums"]["transaction_type"] | null
          duplicate_of_transaction_id: string | null
          extracted_at: string
          extraction_warnings: Json | null
          gmail_attachment_id: string
          gmail_message_id: string
          gmail_thread_id: string | null
          id: string
          item_name: string | null
          normalized_amount_minor: number | null
          normalized_date: string | null
          normalized_merchant: string | null
          parser_version: string
          received_at: string | null
          reference_id: string | null
          review_status: Database["public"]["Enums"]["staged_review_status"]
          sender: string | null
          subject: string | null
          suggested_category_id: string | null
          transfer_pair_candidate_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          account_match_required?: boolean
          candidate_type: Database["public"]["Enums"]["gmail_candidate_type"]
          confidence_score: number
          created_at?: string
          created_transaction_id?: string | null
          currency?: string | null
          direction?: Database["public"]["Enums"]["transaction_type"] | null
          duplicate_of_transaction_id?: string | null
          extracted_at?: string
          extraction_warnings?: Json | null
          gmail_attachment_id?: string
          gmail_message_id: string
          gmail_thread_id?: string | null
          id?: string
          item_name?: string | null
          normalized_amount_minor?: number | null
          normalized_date?: string | null
          normalized_merchant?: string | null
          parser_version: string
          received_at?: string | null
          reference_id?: string | null
          review_status?: Database["public"]["Enums"]["staged_review_status"]
          sender?: string | null
          subject?: string | null
          suggested_category_id?: string | null
          transfer_pair_candidate_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          account_match_required?: boolean
          candidate_type?: Database["public"]["Enums"]["gmail_candidate_type"]
          confidence_score?: number
          created_at?: string
          created_transaction_id?: string | null
          currency?: string | null
          direction?: Database["public"]["Enums"]["transaction_type"] | null
          duplicate_of_transaction_id?: string | null
          extracted_at?: string
          extraction_warnings?: Json | null
          gmail_attachment_id?: string
          gmail_message_id?: string
          gmail_thread_id?: string | null
          id?: string
          item_name?: string | null
          normalized_amount_minor?: number | null
          normalized_date?: string | null
          normalized_merchant?: string | null
          parser_version?: string
          received_at?: string | null
          reference_id?: string | null
          review_status?: Database["public"]["Enums"]["staged_review_status"]
          sender?: string | null
          subject?: string | null
          suggested_category_id?: string | null
          transfer_pair_candidate_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_financial_candidates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gmail_financial_candidates_created_transaction_id_fkey"
            columns: ["created_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gmail_financial_candidates_duplicate_of_transaction_id_fkey"
            columns: ["duplicate_of_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gmail_financial_candidates_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gmail_financial_candidates_transfer_pair_candidate_id_fkey"
            columns: ["transfer_pair_candidate_id"]
            isOneToOne: false
            referencedRelation: "gmail_financial_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_contribution_plans: {
        Row: {
          amount_minor: number
          anchor_day: number | null
          anchor_month: number | null
          created_at: string
          frequency: Database["public"]["Enums"]["goal_contribution_frequency"]
          goal_id: string
          id: string
          next_due_at: string | null
          start_date: string
          status: Database["public"]["Enums"]["goal_plan_status"]
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          anchor_day?: number | null
          anchor_month?: number | null
          created_at?: string
          frequency: Database["public"]["Enums"]["goal_contribution_frequency"]
          goal_id: string
          id?: string
          next_due_at?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["goal_plan_status"]
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          anchor_day?: number | null
          anchor_month?: number | null
          created_at?: string
          frequency?: Database["public"]["Enums"]["goal_contribution_frequency"]
          goal_id?: string
          id?: string
          next_due_at?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["goal_plan_status"]
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_contribution_plans_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          archived_at: string | null
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          funding_account_id: string
          id: string
          image_url: string | null
          name: string
          saved_amount_minor: number
          status: Database["public"]["Enums"]["goal_status"]
          target_amount_minor: number
          target_date: string | null
          term: Database["public"]["Enums"]["goal_term"]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          funding_account_id: string
          id?: string
          image_url?: string | null
          name: string
          saved_amount_minor?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_amount_minor: number
          target_date?: string | null
          term?: Database["public"]["Enums"]["goal_term"]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          funding_account_id?: string
          id?: string
          image_url?: string | null
          name?: string
          saved_amount_minor?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_amount_minor?: number
          target_date?: string | null
          term?: Database["public"]["Enums"]["goal_term"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_funding_account_id_fkey"
            columns: ["funding_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          account_id: string | null
          cancelled_at: string | null
          confidence_summary: Json | null
          confirmed_at: string | null
          created_at: string
          file_name: string | null
          file_size_bytes: number | null
          id: string
          raw_extraction_ref: string | null
          source_type: Database["public"]["Enums"]["import_source_type"]
          status: Database["public"]["Enums"]["import_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          cancelled_at?: string | null
          confidence_summary?: Json | null
          confirmed_at?: string | null
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          raw_extraction_ref?: string | null
          source_type: Database["public"]["Enums"]["import_source_type"]
          status?: Database["public"]["Enums"]["import_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          cancelled_at?: string | null
          confidence_summary?: Json | null
          confirmed_at?: string | null
          created_at?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          raw_extraction_ref?: string | null
          source_type?: Database["public"]["Enums"]["import_source_type"]
          status?: Database["public"]["Enums"]["import_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      import_staged_transactions: {
        Row: {
          confidence_score: number
          created_at: string
          created_transaction_id: string | null
          duplicate_of_transaction_id: string | null
          id: string
          import_batch_id: string
          normalized_amount_minor: number
          normalized_date: string
          normalized_merchant: string | null
          raw_payload: Json
          review_status: Database["public"]["Enums"]["staged_review_status"]
          staged_transaction_type: Database["public"]["Enums"]["transaction_type"]
          suggested_category_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence_score: number
          created_at?: string
          created_transaction_id?: string | null
          duplicate_of_transaction_id?: string | null
          id?: string
          import_batch_id: string
          normalized_amount_minor: number
          normalized_date: string
          normalized_merchant?: string | null
          raw_payload: Json
          review_status?: Database["public"]["Enums"]["staged_review_status"]
          staged_transaction_type: Database["public"]["Enums"]["transaction_type"]
          suggested_category_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          created_transaction_id?: string | null
          duplicate_of_transaction_id?: string | null
          id?: string
          import_batch_id?: string
          normalized_amount_minor?: number
          normalized_date?: string
          normalized_merchant?: string | null
          raw_payload?: Json
          review_status?: Database["public"]["Enums"]["staged_review_status"]
          staged_transaction_type?: Database["public"]["Enums"]["transaction_type"]
          suggested_category_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_staged_transactions_created_transaction_id_fkey"
            columns: ["created_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_staged_transactions_duplicate_of_transaction_id_fkey"
            columns: ["duplicate_of_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_staged_transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_staged_transactions_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_sessions: {
        Row: {
          client_name: string
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          user_id: string
        }
        Insert: {
          client_name: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes: string[]
          token_hash: string
          user_id: string
        }
        Update: {
          client_name?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_alert_state: {
        Row: {
          alert_type: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          last_alerted_at: string
          last_value: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          last_alerted_at?: string
          last_value?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          last_alerted_at?: string
          last_value?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_deliveries: {
        Row: {
          attempted_at: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          delivered_at: string | null
          error_code: string | null
          failed_at: string | null
          id: string
          notification_id: string
          provider_message_id: string | null
          retry_count: number
          status: Database["public"]["Enums"]["delivery_status"]
        }
        Insert: {
          attempted_at?: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          failed_at?: string | null
          id?: string
          notification_id: string
          provider_message_id?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["delivery_status"]
        }
        Update: {
          attempted_at?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          failed_at?: string | null
          id?: string
          notification_id?: string
          provider_message_id?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["delivery_status"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          enabled: boolean
          event_type: string | null
          id: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          enabled?: boolean
          event_type?: string | null
          id?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          enabled?: boolean
          event_type?: string | null
          id?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          category: Database["public"]["Enums"]["notification_category"] | null
          created_at: string
          dedupe_key: string | null
          entity_id: string | null
          entity_type: string | null
          event_type: string | null
          expires_at: string | null
          financial_context: Json | null
          id: string
          payload: Json | null
          read_at: string | null
          severity: Database["public"]["Enums"]["notification_severity"]
          title: string | null
          type: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          category?: Database["public"]["Enums"]["notification_category"] | null
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string | null
          expires_at?: string | null
          financial_context?: Json | null
          id?: string
          payload?: Json | null
          read_at?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          title?: string | null
          type: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          category?: Database["public"]["Enums"]["notification_category"] | null
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string | null
          expires_at?: string | null
          financial_context?: Json | null
          id?: string
          payload?: Json | null
          read_at?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          title?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      oauth_authorization_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          scopes: string[]
          user_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          redirect_uri: string
          scopes: string[]
          user_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri?: string
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorization_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_name: string
          created_at: string
          id: string
          redirect_uris: string[]
        }
        Insert: {
          client_id: string
          client_name: string
          created_at?: string
          id?: string
          redirect_uris: string[]
        }
        Update: {
          client_id?: string
          client_name?: string
          created_at?: string
          id?: string
          redirect_uris?: string[]
        }
        Relationships: []
      }
      pending_confirmations: {
        Row: {
          cancelled_at: string | null
          command_type: string
          confirmed_at: string | null
          created_at: string
          expires_at: string
          id: string
          payload: Json
          preview: Json
          source: Database["public"]["Enums"]["confirmation_source"]
          status: Database["public"]["Enums"]["confirmation_status"]
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          command_type: string
          confirmed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          payload: Json
          preview: Json
          source: Database["public"]["Enums"]["confirmation_source"]
          status?: Database["public"]["Enums"]["confirmation_status"]
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          command_type?: string
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          payload?: Json
          preview?: Json
          source?: Database["public"]["Enums"]["confirmation_source"]
          status?: Database["public"]["Enums"]["confirmation_status"]
          user_id?: string
        }
        Relationships: []
      }
      loans: {
        Row: {
          created_at: string
          currency: string
          deleted_at: string | null
          end_date: string | null
          id: string
          installment_amount_minor: number
          interest_rate_pct: number | null
          lender_name: string | null
          loan_type: "home" | "car" | "bike" | "personal" | "education" | "business" | "other"
          name: string
          next_payment_date: string | null
          notes: string | null
          outstanding_minor: number | null
          payment_account_id: string | null
          principal_minor: number
          repayment_frequency: Database["public"]["Enums"]["recurrence_interval"]
          start_date: string | null
          status: "active" | "completed" | "cancelled"
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          installment_amount_minor: number
          interest_rate_pct?: number | null
          lender_name?: string | null
          loan_type?: "home" | "car" | "bike" | "personal" | "education" | "business" | "other"
          name: string
          next_payment_date?: string | null
          notes?: string | null
          outstanding_minor?: number | null
          payment_account_id?: string | null
          principal_minor: number
          repayment_frequency?: Database["public"]["Enums"]["recurrence_interval"]
          start_date?: string | null
          status?: "active" | "completed" | "cancelled"
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          installment_amount_minor?: number
          interest_rate_pct?: number | null
          lender_name?: string | null
          loan_type?: "home" | "car" | "bike" | "personal" | "education" | "business" | "other"
          name?: string
          next_payment_date?: string | null
          notes?: string | null
          outstanding_minor?: number | null
          payment_account_id?: string | null
          principal_minor?: number
          repayment_frequency?: Database["public"]["Enums"]["recurrence_interval"]
          start_date?: string | null
          status?: "active" | "completed" | "cancelled"
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      planned_commitment_occurrences: {
        Row: {
          amount_minor: number
          commitment_id: string
          created_at: string
          due_date: string
          id: string
          matched_transaction_id: string | null
          paid_at: string | null
          reserved_minor: number
          status: "upcoming" | "paid" | "skipped"
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          commitment_id: string
          created_at?: string
          due_date: string
          id?: string
          matched_transaction_id?: string | null
          paid_at?: string | null
          reserved_minor?: number
          status?: "upcoming" | "paid" | "skipped"
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          commitment_id?: string
          created_at?: string
          due_date?: string
          id?: string
          matched_transaction_id?: string | null
          paid_at?: string | null
          reserved_minor?: number
          status?: "upcoming" | "paid" | "skipped"
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planned_commitment_occurrences_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "planned_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_commitment_occurrences_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_commitments: {
        Row: {
          amount_is_estimate: boolean
          amount_minor: number
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          first_saving_date: string | null
          funding_account_id: string | null
          id: string
          migrated_from_bill_id: string | null
          name: string
          next_payment_date: string
          notes: string | null
          payment_account_id: string | null
          payment_frequency: Database["public"]["Enums"]["recurrence_interval"]
          reserve_account_id: string | null
          saving_amount_minor: number | null
          saving_cadence: Database["public"]["Enums"]["recurrence_interval"] | null
          status: "active" | "paused" | "completed" | "cancelled"
          tenure_end_date: string | null
          tenure_payments: number | null
          tenure_type: "none" | "n_payments" | "end_date"
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_is_estimate?: boolean
          amount_minor: number
          category_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          first_saving_date?: string | null
          funding_account_id?: string | null
          id?: string
          migrated_from_bill_id?: string | null
          name: string
          next_payment_date: string
          notes?: string | null
          payment_account_id?: string | null
          payment_frequency: Database["public"]["Enums"]["recurrence_interval"]
          reserve_account_id?: string | null
          saving_amount_minor?: number | null
          saving_cadence?: Database["public"]["Enums"]["recurrence_interval"] | null
          status?: "active" | "paused" | "completed" | "cancelled"
          tenure_end_date?: string | null
          tenure_payments?: number | null
          tenure_type?: "none" | "n_payments" | "end_date"
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_is_estimate?: boolean
          amount_minor?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          first_saving_date?: string | null
          funding_account_id?: string | null
          id?: string
          migrated_from_bill_id?: string | null
          name?: string
          next_payment_date?: string
          notes?: string | null
          payment_account_id?: string | null
          payment_frequency?: Database["public"]["Enums"]["recurrence_interval"]
          reserve_account_id?: string | null
          saving_amount_minor?: number | null
          saving_cadence?: Database["public"]["Enums"]["recurrence_interval"] | null
          status?: "active" | "paused" | "completed" | "cancelled"
          tenure_end_date?: string | null
          tenure_payments?: number | null
          tenure_type?: "none" | "n_payments" | "end_date"
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planned_commitments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_commitments_funding_account_id_fkey"
            columns: ["funding_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_commitments_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_commitments_reserve_account_id_fkey"
            columns: ["reserve_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_commitments_migrated_from_bill_id_fkey"
            columns: ["migrated_from_bill_id"]
            isOneToOne: false
            referencedRelation: "bill_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          income_amount_minor: number | null
          income_frequency: string | null
          interested_categories: string[]
          interested_goal_types: string[]
          onboarding_completed_at: string | null
          preferred_currency: string
          privacy_mode_enabled: boolean
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          income_amount_minor?: number | null
          income_frequency?: string | null
          interested_categories?: string[]
          interested_goal_types?: string[]
          onboarding_completed_at?: string | null
          preferred_currency?: string
          privacy_mode_enabled?: boolean
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          income_amount_minor?: number | null
          income_frequency?: string | null
          interested_categories?: string[]
          interested_goal_types?: string[]
          onboarding_completed_at?: string | null
          preferred_currency?: string
          privacy_mode_enabled?: boolean
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          attempt_count: number
          bucket_key: string
          window_start: string
        }
        Insert: {
          attempt_count?: number
          bucket_key: string
          window_start: string
        }
        Update: {
          attempt_count?: number
          bucket_key?: string
          window_start?: string
        }
        Relationships: []
      }
      security_settings: {
        Row: {
          backup_codes_hash: string[] | null
          pin_lock_enabled: boolean
          totp_secret_encrypted: string | null
          two_factor_enabled: boolean
          two_factor_method:
            | Database["public"]["Enums"]["two_factor_method"]
            | null
          updated_at: string
          user_id: string
        }
        Insert: {
          backup_codes_hash?: string[] | null
          pin_lock_enabled?: boolean
          totp_secret_encrypted?: string | null
          two_factor_enabled?: boolean
          two_factor_method?:
            | Database["public"]["Enums"]["two_factor_method"]
            | null
          updated_at?: string
          user_id: string
        }
        Update: {
          backup_codes_hash?: string[] | null
          pin_lock_enabled?: boolean
          totp_secret_encrypted?: string | null
          two_factor_enabled?: boolean
          two_factor_method?:
            | Database["public"]["Enums"]["two_factor_method"]
            | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_link_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount_minor: number
          bill_prediction_id: string | null
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          goal_id: string | null
          id: string
          import_batch_id: string | null
          item_name: string | null
          merchant: string | null
          occurred_at: string
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount_minor: number
          bill_prediction_id?: string | null
          category_id?: string | null
          created_at?: string
          currency: string
          deleted_at?: string | null
          description?: string | null
          goal_id?: string | null
          id?: string
          import_batch_id?: string | null
          item_name?: string | null
          merchant?: string | null
          occurred_at: string
          status?: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount_minor?: number
          bill_prediction_id?: string | null
          category_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string | null
          goal_id?: string | null
          id?: string
          import_batch_id?: string | null
          item_name?: string | null
          merchant?: string | null
          occurred_at?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_bill_prediction_id_fkey"
            columns: ["bill_prediction_id"]
            isOneToOne: false
            referencedRelation: "bill_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_transfer_pair_id_fkey"
            columns: ["transfer_pair_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_goal_contribution: {
        Args: {
          p_account_id: string
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_amount_minor: number
          p_goal_id: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          bill_prediction_id: string | null
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          goal_id: string | null
          id: string
          import_batch_id: string | null
          item_name: string | null
          merchant: string | null
          occurred_at: string
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_account: {
        Args: {
          p_account_id: string
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_user_id: string
        }
        Returns: {
          balance_minor: number
          created_at: string
          credit_limit_minor: number | null
          credit_used_minor: number | null
          currency: string
          deleted_at: string | null
          id: string
          is_archived: boolean
          market_value_minor: number | null
          name: string
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_and_increment_rate_limit: {
        Args: {
          p_bucket_key: string
          p_max_attempts: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      cleanup_expired_telegram_tokens: { Args: never; Returns: undefined }
      confirm_command: {
        Args: {
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_confirmation_id: string
          p_user_id: string
        }
        Returns: Json
      }
      confirm_import_batch: {
        Args: {
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_import_batch_id: string
          p_user_id: string
        }
        Returns: {
          account_id: string | null
          cancelled_at: string | null
          confidence_summary: Json | null
          confirmed_at: string | null
          created_at: string
          file_name: string | null
          file_size_bytes: number | null
          id: string
          raw_extraction_ref: string | null
          source_type: Database["public"]["Enums"]["import_source_type"]
          status: Database["public"]["Enums"]["import_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "import_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_bill: {
        Args: {
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_category_id?: string
          p_expected_amount_minor?: number
          p_initial_expected_date?: string
          p_merchant_pattern: string
          p_recurrence_interval: Database["public"]["Enums"]["recurrence_interval"]
          p_user_id: string
        }
        Returns: {
          category_id: string | null
          created_at: string
          deleted_at: string | null
          detection_source: string
          expected_amount_minor: number | null
          expected_amount_tolerance_pct: number | null
          id: string
          merchant_pattern: string
          recurrence_interval: Database["public"]["Enums"]["recurrence_interval"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "bill_definitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_transaction: {
        Args: {
          p_account_id: string
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_amount_minor: number
          p_category_id: string
          p_description?: string
          p_item_name?: string
          p_merchant?: string
          p_occurred_at: string
          p_type: Database["public"]["Enums"]["transaction_type"]
          p_user_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          bill_prediction_id: string | null
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          goal_id: string | null
          id: string
          import_batch_id: string | null
          item_name: string | null
          merchant: string | null
          occurred_at: string
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_own_account: { Args: { p_user_id: string }; Returns: undefined }
      delete_transaction: {
        Args: {
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_transaction_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      mark_bill_paid: {
        Args: {
          p_account_id: string
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_amount_minor: number
          p_category_id: string
          p_description?: string
          p_merchant?: string
          p_occurred_at: string
          p_prediction_id: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          bill_prediction_id: string | null
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          goal_id: string | null
          id: string
          import_batch_id: string | null
          item_name: string | null
          merchant: string | null
          occurred_at: string
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      match_bill_transaction: {
        Args: {
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_prediction_id: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: {
          bill_definition_id: string
          created_at: string
          expected_amount_minor: number | null
          expected_date: string
          id: string
          matched_at: string | null
          matched_transaction_id: string | null
          status: Database["public"]["Enums"]["bill_prediction_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "bill_predictions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_active_ai_provider_credential: {
        Args: {
          p_encrypted_api_key: string
          p_key_last_four: string
          p_provider: Database["public"]["Enums"]["ai_provider"]
          p_user_id: string
        }
        Returns: {
          created_at: string
          deactivated_at: string | null
          encrypted_api_key: string
          id: string
          is_active: boolean
          key_last_four: string
          last_validated_at: string | null
          last_validation_error: string | null
          provider: Database["public"]["Enums"]["ai_provider"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_provider_credentials"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transfer: {
        Args: {
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_amount_minor: number
          p_description?: string
          p_from_account_id: string
          p_occurred_at: string
          p_to_account_id: string
          p_user_id: string
        }
        Returns: {
          from_leg: Database["public"]["Tables"]["transactions"]["Row"]
          to_leg: Database["public"]["Tables"]["transactions"]["Row"]
        }[]
      }
      update_transaction: {
        Args: {
          p_account_id: string
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_amount_minor: number
          p_category_id: string
          p_description?: string
          p_item_name?: string
          p_merchant?: string
          p_occurred_at: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          bill_prediction_id: string | null
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          goal_id: string | null
          id: string
          import_batch_id: string | null
          item_name: string | null
          merchant: string | null
          occurred_at: string
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      withdraw_goal_contribution: {
        Args: {
          p_account_id: string
          p_actor?: Database["public"]["Enums"]["audit_actor"]
          p_amount_minor: number
          p_goal_id: string
          p_user_id: string
        }
        Returns: {
          account_id: string
          amount_minor: number
          bill_prediction_id: string | null
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          goal_id: string | null
          id: string
          import_batch_id: string | null
          item_name: string | null
          merchant: string | null
          occurred_at: string
          status: Database["public"]["Enums"]["transaction_status"]
          transfer_pair_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      account_type: "bank" | "cash" | "credit_card" | "investment"
      ai_provider: "anthropic" | "openai" | "google" | "openrouter" | "other"
      audit_actor: "web" | "spensa" | "mcp" | "system" | "gmail"
      bill_prediction_status: "open" | "matched" | "skipped" | "overdue"
      channel_connection_status: "connected" | "disconnected"
      confirmation_source: "web" | "spensa" | "mcp" | "gmail"
      confirmation_status: "pending" | "confirmed" | "cancelled" | "expired"
      delivery_status: "pending" | "delivered" | "failed" | "skipped"
      gmail_candidate_type: "transaction" | "bill" | "statement" | "other"
      gmail_sync_status: "idle" | "syncing" | "success" | "error"
      goal_contribution_frequency:
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "half_yearly"
        | "yearly"
      goal_plan_status: "active" | "paused" | "completed"
      goal_status: "active" | "completed" | "archived"
      goal_term: "short" | "long"
      import_source_type: "csv" | "pdf_statement" | "manual" | "copy_paste"
      import_status:
        | "uploaded"
        | "processing"
        | "awaiting_review"
        | "confirmed"
        | "failed"
        | "cancelled"
      notification_category:
        | "budget"
        | "goal"
        | "account"
        | "bill"
        | "transaction"
        | "security"
        | "report"
        | "spensa"
      notification_channel: "in_app" | "email" | "telegram" | "slack"
      notification_severity: "info" | "warning" | "critical" | "success"
      recurrence_interval:
        | "weekly"
        | "biweekly"
        | "monthly"
        | "quarterly"
        | "yearly"
        | "irregular"
      staged_review_status:
        | "pending"
        | "accepted"
        | "edited"
        | "rejected"
        | "matched_existing"
      transaction_status: "posted" | "pending"
      transaction_type:
        | "income"
        | "expense"
        | "transfer"
        | "goal_contribution"
        | "goal_withdrawal"
      two_factor_method: "totp" | "email_otp"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["bank", "cash", "credit_card", "investment"],
      ai_provider: ["anthropic", "openai", "google", "openrouter", "other"],
      audit_actor: ["web", "spensa", "mcp", "system", "gmail"],
      bill_prediction_status: ["open", "matched", "skipped", "overdue"],
      channel_connection_status: ["connected", "disconnected"],
      confirmation_source: ["web", "spensa", "mcp", "gmail"],
      confirmation_status: ["pending", "confirmed", "cancelled", "expired"],
      delivery_status: ["pending", "delivered", "failed", "skipped"],
      gmail_candidate_type: ["transaction", "bill", "statement", "other"],
      gmail_sync_status: ["idle", "syncing", "success", "error"],
      goal_contribution_frequency: [
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "half_yearly",
        "yearly",
      ],
      goal_plan_status: ["active", "paused", "completed"],
      goal_status: ["active", "completed", "archived"],
      goal_term: ["short", "long"],
      import_source_type: ["csv", "pdf_statement", "manual", "copy_paste"],
      import_status: [
        "uploaded",
        "processing",
        "awaiting_review",
        "confirmed",
        "failed",
        "cancelled",
      ],
      notification_category: [
        "budget",
        "goal",
        "account",
        "bill",
        "transaction",
        "security",
        "report",
        "spensa",
      ],
      notification_channel: ["in_app", "email", "telegram", "slack"],
      notification_severity: ["info", "warning", "critical", "success"],
      recurrence_interval: [
        "weekly",
        "biweekly",
        "monthly",
        "quarterly",
        "yearly",
        "irregular",
      ],
      staged_review_status: [
        "pending",
        "accepted",
        "edited",
        "rejected",
        "matched_existing",
      ],
      transaction_status: ["posted", "pending"],
      transaction_type: [
        "income",
        "expense",
        "transfer",
        "goal_contribution",
        "goal_withdrawal",
      ],
      two_factor_method: ["totp", "email_otp"],
    },
  },
} as const
