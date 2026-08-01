export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ack_cadence_config: {
        Row: {
          house_id: string;
          modified_at: string;
          modified_by: string | null;
          reminder_2h_enabled: boolean;
          reminder_2h_offset: string | null;
          reminder_6h_enabled: boolean;
          reminder_6h_offset: string | null;
        };
        Insert: {
          house_id: string;
          modified_at?: string;
          modified_by?: string | null;
          reminder_2h_enabled?: boolean;
          reminder_2h_offset?: string | null;
          reminder_6h_enabled?: boolean;
          reminder_6h_offset?: string | null;
        };
        Update: {
          house_id?: string;
          modified_at?: string;
          modified_by?: string | null;
          reminder_2h_enabled?: boolean;
          reminder_2h_offset?: string | null;
          reminder_6h_enabled?: boolean;
          reminder_6h_offset?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ack_cadence_config_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: true;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ack_cadence_config_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: true;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ack_cadence_config_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'ack_cadence_config_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'ack_cadence_config_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      allied_coverage_requests: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          block_id: string;
          close_note: string | null;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          current_recipient: string | null;
          current_rung: string;
          house_id: string;
          last_reminder_at: string | null;
          outcome: Database['public']['Enums']['allied_coverage_outcome'] | null;
          reason: string;
          request_id: string;
          rung_fired_at: string;
          window_end_at: string;
          window_start_at: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          block_id: string;
          close_note?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          current_recipient?: string | null;
          current_rung: string;
          house_id: string;
          last_reminder_at?: string | null;
          outcome?: Database['public']['Enums']['allied_coverage_outcome'] | null;
          reason: string;
          request_id?: string;
          rung_fired_at: string;
          window_end_at: string;
          window_start_at: string;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          block_id?: string;
          close_note?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          current_recipient?: string | null;
          current_rung?: string;
          house_id?: string;
          last_reminder_at?: string | null;
          outcome?: Database['public']['Enums']['allied_coverage_outcome'] | null;
          reason?: string;
          request_id?: string;
          rung_fired_at?: string;
          window_end_at?: string;
          window_start_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'allied_coverage_requests_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'house_schedule_grid';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_current_recipient_fkey';
            columns: ['current_recipient'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_current_recipient_fkey';
            columns: ['current_recipient'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_current_recipient_fkey';
            columns: ['current_recipient'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allied_coverage_requests_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      allied_page_ladder: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          block_id: string;
          block_start_at: string;
          created_at: string;
          current_rung: string;
          dropped_by_user_id: string | null;
          house_id: string;
          resolved_at: string | null;
          rung_fired_at: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          block_id: string;
          block_start_at: string;
          created_at?: string;
          current_rung: string;
          dropped_by_user_id?: string | null;
          house_id: string;
          resolved_at?: string | null;
          rung_fired_at: string;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          block_id?: string;
          block_start_at?: string;
          created_at?: string;
          current_rung?: string;
          dropped_by_user_id?: string | null;
          house_id?: string;
          resolved_at?: string | null;
          rung_fired_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'allied_page_ladder_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_acknowledged_by_fkey';
            columns: ['acknowledged_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: true;
            referencedRelation: 'house_schedule_grid';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: true;
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_dropped_by_user_id_fkey';
            columns: ['dropped_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_dropped_by_user_id_fkey';
            columns: ['dropped_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_dropped_by_user_id_fkey';
            columns: ['dropped_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'allied_page_ladder_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      block_step_status: {
        Row: {
          block_id: string;
          fired_at: string;
          status: Database['public']['Enums']['block_step_status_enum'];
          step_name: string;
          updated_at: string;
        };
        Insert: {
          block_id: string;
          fired_at?: string;
          status: Database['public']['Enums']['block_step_status_enum'];
          step_name: string;
          updated_at?: string;
        };
        Update: {
          block_id?: string;
          fired_at?: string;
          status?: Database['public']['Enums']['block_step_status_enum'];
          step_name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'block_step_status_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'house_schedule_grid';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'block_step_status_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
        ];
      };
      break_optouts: {
        Row: {
          break_id: string;
          opted_out_at: string;
          user_id: string;
        };
        Insert: {
          break_id: string;
          opted_out_at?: string;
          user_id: string;
        };
        Update: {
          break_id?: string;
          opted_out_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'break_optouts_break_id_fkey';
            columns: ['break_id'];
            isOneToOne: false;
            referencedRelation: 'break_periods';
            referencedColumns: ['break_id'];
          },
          {
            foreignKeyName: 'break_optouts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'break_optouts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'break_optouts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      break_periods: {
        Row: {
          break_id: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          claim_pool_closed_at: string | null;
          end_date: string;
          profile_name: string;
          start_date: string;
        };
        Insert: {
          break_id?: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          claim_pool_closed_at?: string | null;
          end_date: string;
          profile_name: string;
          start_date: string;
        };
        Update: {
          break_id?: string;
          break_name?: string;
          break_type?: Database['public']['Enums']['break_type_enum'];
          claim_pool_closed_at?: string | null;
          end_date?: string;
          profile_name?: string;
          start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'break_periods_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      break_phase_log: {
        Row: {
          break_id: string;
          executed_at: string;
          phase: string;
        };
        Insert: {
          break_id: string;
          executed_at?: string;
          phase: string;
        };
        Update: {
          break_id?: string;
          executed_at?: string;
          phase?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'break_phase_log_break_id_fkey';
            columns: ['break_id'];
            isOneToOne: false;
            referencedRelation: 'break_periods';
            referencedColumns: ['break_id'];
          },
        ];
      };
      da_conversations: {
        Row: {
          conversation_id: string;
          created_at: string;
          house_id: string;
          surface: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          conversation_id?: string;
          created_at?: string;
          house_id: string;
          surface?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          house_id?: string;
          surface?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'da_conversations_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'da_conversations_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'da_conversations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_conversations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_conversations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      da_messages: {
        Row: {
          citations: Json;
          content: string;
          conversation_id: string;
          created_at: string;
          deferred: boolean;
          message_id: string;
          role: string;
        };
        Insert: {
          citations?: Json;
          content: string;
          conversation_id: string;
          created_at?: string;
          deferred?: boolean;
          message_id?: string;
          role: string;
        };
        Update: {
          citations?: Json;
          content?: string;
          conversation_id?: string;
          created_at?: string;
          deferred?: boolean;
          message_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'da_messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'da_conversations';
            referencedColumns: ['conversation_id'];
          },
        ];
      };
      da_page_deliveries: {
        Row: {
          adapter: string;
          created_at: string;
          delivered_at: string | null;
          delivery_id: string;
          draft_id: string;
          next_reminder_at: string | null;
          recipient_user_id: string;
          reminder_count: number;
          responded_at: string | null;
          response: string | null;
          severity: string;
          status: string;
        };
        Insert: {
          adapter: string;
          created_at?: string;
          delivered_at?: string | null;
          delivery_id?: string;
          draft_id: string;
          next_reminder_at?: string | null;
          recipient_user_id: string;
          reminder_count?: number;
          responded_at?: string | null;
          response?: string | null;
          severity?: string;
          status?: string;
        };
        Update: {
          adapter?: string;
          created_at?: string;
          delivered_at?: string | null;
          delivery_id?: string;
          draft_id?: string;
          next_reminder_at?: string | null;
          recipient_user_id?: string;
          reminder_count?: number;
          responded_at?: string | null;
          response?: string | null;
          severity?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'da_page_deliveries_draft_id_fkey';
            columns: ['draft_id'];
            isOneToOne: false;
            referencedRelation: 'da_page_drafts';
            referencedColumns: ['draft_id'];
          },
          {
            foreignKeyName: 'da_page_deliveries_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_page_deliveries_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_page_deliveries_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      da_page_drafts: {
        Row: {
          author_user_id: string;
          body: string | null;
          conversation_id: string | null;
          created_at: string;
          draft_id: string;
          fields: Json;
          handoff_adapter: string;
          house_id: string;
          issue_type: string;
          missing_fields: string[];
          resolved_recipient_user_id: string | null;
          resolved_tier: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          author_user_id: string;
          body?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          draft_id?: string;
          fields?: Json;
          handoff_adapter?: string;
          house_id: string;
          issue_type: string;
          missing_fields?: string[];
          resolved_recipient_user_id?: string | null;
          resolved_tier?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          author_user_id?: string;
          body?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          draft_id?: string;
          fields?: Json;
          handoff_adapter?: string;
          house_id?: string;
          issue_type?: string;
          missing_fields?: string[];
          resolved_recipient_user_id?: string | null;
          resolved_tier?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'da_page_drafts_author_user_id_fkey';
            columns: ['author_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_page_drafts_author_user_id_fkey';
            columns: ['author_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_page_drafts_author_user_id_fkey';
            columns: ['author_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'da_page_drafts_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'da_conversations';
            referencedColumns: ['conversation_id'];
          },
          {
            foreignKeyName: 'da_page_drafts_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'da_page_drafts_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'da_page_drafts_resolved_recipient_user_id_fkey';
            columns: ['resolved_recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_page_drafts_resolved_recipient_user_id_fkey';
            columns: ['resolved_recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'da_page_drafts_resolved_recipient_user_id_fkey';
            columns: ['resolved_recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      dev_sim_clock: {
        Row: {
          id: boolean;
          offset_seconds: number;
          set_at: string | null;
          set_by: string | null;
        };
        Insert: {
          id?: boolean;
          offset_seconds?: number;
          set_at?: string | null;
          set_by?: string | null;
        };
        Update: {
          id?: boolean;
          offset_seconds?: number;
          set_at?: string | null;
          set_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'dev_sim_clock_set_by_fkey';
            columns: ['set_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'dev_sim_clock_set_by_fkey';
            columns: ['set_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'dev_sim_clock_set_by_fkey';
            columns: ['set_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      draft_block_assignments: {
        Row: {
          block_id: string;
          created_at: string;
          created_by: string;
          draft_assignment_id: string;
          period_id: string;
          user_id: string;
        };
        Insert: {
          block_id: string;
          created_at?: string;
          created_by: string;
          draft_assignment_id?: string;
          period_id: string;
          user_id: string;
        };
        Update: {
          block_id?: string;
          created_at?: string;
          created_by?: string;
          draft_assignment_id?: string;
          period_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'draft_block_assignments_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'house_schedule_grid';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_period_id_fkey';
            columns: ['period_id'];
            isOneToOne: false;
            referencedRelation: 'scheduling_periods';
            referencedColumns: ['period_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'draft_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      float_assignments: {
        Row: {
          acknowledged_at: string | null;
          created_at: string;
          declined_at: string | null;
          destination_assignment_ids: string[];
          expires_for_cleanup_at: string;
          float_id: string;
          force_triggered_by: string | null;
          initiated_by: Database['public']['Enums']['float_initiated_by_enum'];
          no_ack_at: string | null;
          source_assignment_ids: string[];
          status: Database['public']['Enums']['float_status_enum'];
          user_id: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          created_at?: string;
          declined_at?: string | null;
          destination_assignment_ids: string[];
          expires_for_cleanup_at: string;
          float_id?: string;
          force_triggered_by?: string | null;
          initiated_by: Database['public']['Enums']['float_initiated_by_enum'];
          no_ack_at?: string | null;
          source_assignment_ids: string[];
          status: Database['public']['Enums']['float_status_enum'];
          user_id: string;
        };
        Update: {
          acknowledged_at?: string | null;
          created_at?: string;
          declined_at?: string | null;
          destination_assignment_ids?: string[];
          expires_for_cleanup_at?: string;
          float_id?: string;
          force_triggered_by?: string | null;
          initiated_by?: Database['public']['Enums']['float_initiated_by_enum'];
          no_ack_at?: string | null;
          source_assignment_ids?: string[];
          status?: Database['public']['Enums']['float_status_enum'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'float_assignments_force_triggered_by_fkey';
            columns: ['force_triggered_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_force_triggered_by_fkey';
            columns: ['force_triggered_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_force_triggered_by_fkey';
            columns: ['force_triggered_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      float_exclusions: {
        Row: {
          destination_house_id: string;
          excluded_at: string;
          exclusion_id: string;
          reason: Database['public']['Enums']['float_exclusion_reason_enum'];
          user_id: string;
          window_end_at: string;
          window_start_at: string;
        };
        Insert: {
          destination_house_id: string;
          excluded_at?: string;
          exclusion_id?: string;
          reason: Database['public']['Enums']['float_exclusion_reason_enum'];
          user_id: string;
          window_end_at: string;
          window_start_at: string;
        };
        Update: {
          destination_house_id?: string;
          excluded_at?: string;
          exclusion_id?: string;
          reason?: Database['public']['Enums']['float_exclusion_reason_enum'];
          user_id?: string;
          window_end_at?: string;
          window_start_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'float_exclusions_destination_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'float_exclusions_destination_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'float_exclusions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_exclusions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_exclusions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      float_routing: {
        Row: {
          destination_house_id: string;
          precedence_order: number;
          profile_name: string;
          source_house_id: string;
        };
        Insert: {
          destination_house_id: string;
          precedence_order: number;
          profile_name: string;
          source_house_id: string;
        };
        Update: {
          destination_house_id?: string;
          precedence_order?: number;
          profile_name?: string;
          source_house_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'float_routing_destination_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'float_routing_destination_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'float_routing_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
          {
            foreignKeyName: 'float_routing_source_house_id_fkey';
            columns: ['source_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'float_routing_source_house_id_fkey';
            columns: ['source_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      hm_leave: {
        Row: {
          cancelled_at: string | null;
          end_date: string;
          leave_id: string;
          replacement_user_id: string | null;
          start_date: string;
          status: Database['public']['Enums']['hm_leave_status_enum'];
          user_id: string;
        };
        Insert: {
          cancelled_at?: string | null;
          end_date: string;
          leave_id?: string;
          replacement_user_id?: string | null;
          start_date: string;
          status?: Database['public']['Enums']['hm_leave_status_enum'];
          user_id: string;
        };
        Update: {
          cancelled_at?: string | null;
          end_date?: string;
          leave_id?: string;
          replacement_user_id?: string | null;
          start_date?: string;
          status?: Database['public']['Enums']['hm_leave_status_enum'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hm_leave_replacement_user_id_fkey';
            columns: ['replacement_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'hm_leave_replacement_user_id_fkey';
            columns: ['replacement_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'hm_leave_replacement_user_id_fkey';
            columns: ['replacement_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'hm_leave_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'hm_leave_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'hm_leave_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      hmod_rotor: {
        Row: {
          hmod_user_id: string;
          week_start_date: string;
        };
        Insert: {
          hmod_user_id: string;
          week_start_date: string;
        };
        Update: {
          hmod_user_id?: string;
          week_start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'hmod_rotor_hmod_user_id_fkey';
            columns: ['hmod_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'hmod_rotor_hmod_user_id_fkey';
            columns: ['hmod_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'hmod_rotor_hmod_user_id_fkey';
            columns: ['hmod_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      houses: {
        Row: {
          desk_phone: string | null;
          id: string;
          is_staffable: boolean;
          launch_state: string;
          launched_at: string | null;
          name: string;
        };
        Insert: {
          desk_phone?: string | null;
          id: string;
          is_staffable?: boolean;
          launch_state?: string;
          launched_at?: string | null;
          name: string;
        };
        Update: {
          desk_phone?: string | null;
          id?: string;
          is_staffable?: boolean;
          launch_state?: string;
          launched_at?: string | null;
          name?: string;
        };
        Relationships: [];
      };
      kb_chunks: {
        Row: {
          allowed_roles: string[];
          chunk_id: string;
          chunk_index: number;
          content: string;
          created_at: string;
          document_id: string;
          effective_from: string | null;
          effective_until: string | null;
          embedding: string | null;
          house_scope: string[] | null;
          sensitivity: Database['public']['Enums']['da_sensitivity_enum'];
          temporality: Database['public']['Enums']['da_temporality_enum'];
          token_count: number | null;
        };
        Insert: {
          allowed_roles?: string[];
          chunk_id?: string;
          chunk_index: number;
          content: string;
          created_at?: string;
          document_id: string;
          effective_from?: string | null;
          effective_until?: string | null;
          embedding?: string | null;
          house_scope?: string[] | null;
          sensitivity?: Database['public']['Enums']['da_sensitivity_enum'];
          temporality?: Database['public']['Enums']['da_temporality_enum'];
          token_count?: number | null;
        };
        Update: {
          allowed_roles?: string[];
          chunk_id?: string;
          chunk_index?: number;
          content?: string;
          created_at?: string;
          document_id?: string;
          effective_from?: string | null;
          effective_until?: string | null;
          embedding?: string | null;
          house_scope?: string[] | null;
          sensitivity?: Database['public']['Enums']['da_sensitivity_enum'];
          temporality?: Database['public']['Enums']['da_temporality_enum'];
          token_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'kb_chunks_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'kb_documents';
            referencedColumns: ['document_id'];
          },
        ];
      };
      kb_documents: {
        Row: {
          allowed_roles: string[];
          created_at: string;
          document_id: string;
          effective_from: string | null;
          effective_until: string | null;
          house_scope: string[] | null;
          metadata: Json;
          sensitivity: Database['public']['Enums']['da_sensitivity_enum'];
          source_ref: string;
          source_type: Database['public']['Enums']['da_source_type_enum'];
          temporality: Database['public']['Enums']['da_temporality_enum'];
          title: string;
          updated_at: string;
        };
        Insert: {
          allowed_roles?: string[];
          created_at?: string;
          document_id?: string;
          effective_from?: string | null;
          effective_until?: string | null;
          house_scope?: string[] | null;
          metadata?: Json;
          sensitivity?: Database['public']['Enums']['da_sensitivity_enum'];
          source_ref: string;
          source_type: Database['public']['Enums']['da_source_type_enum'];
          temporality?: Database['public']['Enums']['da_temporality_enum'];
          title: string;
          updated_at?: string;
        };
        Update: {
          allowed_roles?: string[];
          created_at?: string;
          document_id?: string;
          effective_from?: string | null;
          effective_until?: string | null;
          house_scope?: string[] | null;
          metadata?: Json;
          sensitivity?: Database['public']['Enums']['da_sensitivity_enum'];
          source_ref?: string;
          source_type?: Database['public']['Enums']['da_source_type_enum'];
          temporality?: Database['public']['Enums']['da_temporality_enum'];
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      kb_embedding_cache: {
        Row: {
          content_hash: string;
          created_at: string;
          embedding: string;
          hit_count: number;
          last_hit_at: string | null;
          model: string;
          token_count: number;
        };
        Insert: {
          content_hash: string;
          created_at?: string;
          embedding: string;
          hit_count?: number;
          last_hit_at?: string | null;
          model: string;
          token_count?: number;
        };
        Update: {
          content_hash?: string;
          created_at?: string;
          embedding?: string;
          hit_count?: number;
          last_hit_at?: string | null;
          model?: string;
          token_count?: number;
        };
        Relationships: [];
      };
      kb_incidents_raw: {
        Row: {
          classification: string;
          created_at: string;
          house_id: string | null;
          incident_id: string;
          lesson_document_id: string | null;
          occurred_on: string | null;
          raw_content: string;
        };
        Insert: {
          classification?: string;
          created_at?: string;
          house_id?: string | null;
          incident_id?: string;
          lesson_document_id?: string | null;
          occurred_on?: string | null;
          raw_content: string;
        };
        Update: {
          classification?: string;
          created_at?: string;
          house_id?: string | null;
          incident_id?: string;
          lesson_document_id?: string | null;
          occurred_on?: string | null;
          raw_content?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'kb_incidents_raw_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'kb_incidents_raw_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'kb_incidents_raw_lesson_document_id_fkey';
            columns: ['lesson_document_id'];
            isOneToOne: false;
            referencedRelation: 'kb_documents';
            referencedColumns: ['document_id'];
          },
        ];
      };
      kb_intake: {
        Row: {
          created_at: string;
          created_by: string;
          document_id: string | null;
          input_format: string;
          intake_id: string;
          metrics: Json | null;
          normalized_text: string | null;
          original_filename: string;
          original_storage_path: string;
          proposed_meta: Json | null;
          representations: Json;
          status: Database['public']['Enums']['da_intake_status_enum'];
          status_detail: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          document_id?: string | null;
          input_format: string;
          intake_id?: string;
          metrics?: Json | null;
          normalized_text?: string | null;
          original_filename: string;
          original_storage_path: string;
          proposed_meta?: Json | null;
          representations?: Json;
          status?: Database['public']['Enums']['da_intake_status_enum'];
          status_detail?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          document_id?: string | null;
          input_format?: string;
          intake_id?: string;
          metrics?: Json | null;
          normalized_text?: string | null;
          original_filename?: string;
          original_storage_path?: string;
          proposed_meta?: Json | null;
          representations?: Json;
          status?: Database['public']['Enums']['da_intake_status_enum'];
          status_detail?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'kb_intake_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'kb_intake_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'kb_intake_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'kb_intake_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'kb_documents';
            referencedColumns: ['document_id'];
          },
        ];
      };
      leave_config_errors: {
        Row: {
          chain_user_ids: string[];
          detected_at: string;
          error_id: string;
          house_id: string;
          leaving_user_id: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          chain_user_ids?: string[];
          detected_at?: string;
          error_id?: string;
          house_id: string;
          leaving_user_id: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: {
          chain_user_ids?: string[];
          detected_at?: string;
          error_id?: string;
          house_id?: string;
          leaving_user_id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leave_config_errors_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leave_config_errors_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leave_config_errors_leaving_user_id_fkey';
            columns: ['leaving_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'leave_config_errors_leaving_user_id_fkey';
            columns: ['leaving_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'leave_config_errors_leaving_user_id_fkey';
            columns: ['leaving_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'leave_config_errors_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'leave_config_errors_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'leave_config_errors_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          open_shifts_home_house: boolean;
          open_shifts_other_houses: boolean;
          shift_reminder_offsets: number[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          open_shifts_home_house?: boolean;
          open_shifts_other_houses?: boolean;
          shift_reminder_offsets?: number[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          open_shifts_home_house?: boolean;
          open_shifts_other_houses?: boolean;
          shift_reminder_offsets?: number[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notification_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notification_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      notifications: {
        Row: {
          acknowledged_at: string | null;
          created_at: string;
          dead_lettered_at: string | null;
          delivered_at: string | null;
          delivery_attempts: number;
          last_attempt_at: string | null;
          last_delivery_error: string | null;
          notification_id: string;
          payload: Json;
          recipient_user_id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          scheduled_for: string | null;
          suppressed_at: string | null;
          type: Database['public']['Enums']['notification_type'];
        };
        Insert: {
          acknowledged_at?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          delivered_at?: string | null;
          delivery_attempts?: number;
          last_attempt_at?: string | null;
          last_delivery_error?: string | null;
          notification_id?: string;
          payload?: Json;
          recipient_user_id: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          scheduled_for?: string | null;
          suppressed_at?: string | null;
          type: Database['public']['Enums']['notification_type'];
        };
        Update: {
          acknowledged_at?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          delivered_at?: string | null;
          delivery_attempts?: number;
          last_attempt_at?: string | null;
          last_delivery_error?: string | null;
          notification_id?: string;
          payload?: Json;
          recipient_user_id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          scheduled_for?: string | null;
          suppressed_at?: string | null;
          type?: Database['public']['Enums']['notification_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notifications_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notifications_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'notifications_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notifications_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notifications_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      operating_calendar: {
        Row: {
          date: string;
          profile_name: string;
        };
        Insert: {
          date: string;
          profile_name: string;
        };
        Update: {
          date?: string;
          profile_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operating_calendar_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      operating_config_audit: {
        Row: {
          action: string;
          applied_at: string;
          applied_by: string | null;
          audit_id: string;
          impact: Json;
          payload: Json;
          season_id: string | null;
        };
        Insert: {
          action: string;
          applied_at?: string;
          applied_by?: string | null;
          audit_id?: string;
          impact: Json;
          payload: Json;
          season_id?: string | null;
        };
        Update: {
          action?: string;
          applied_at?: string;
          applied_by?: string | null;
          audit_id?: string;
          impact?: Json;
          payload?: Json;
          season_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'operating_config_audit_applied_by_fkey';
            columns: ['applied_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'operating_config_audit_applied_by_fkey';
            columns: ['applied_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'operating_config_audit_applied_by_fkey';
            columns: ['applied_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'operating_config_audit_season_id_fkey';
            columns: ['season_id'];
            isOneToOne: false;
            referencedRelation: 'operating_seasons';
            referencedColumns: ['season_id'];
          },
        ];
      };
      operating_profiles: {
        Row: {
          claim_phase_alert_offset: string | null;
          claim_phase_close_offset: string | null;
          claim_phase_open_offset: string | null;
          default_cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          default_hours_cap: number;
          escalation_chain: Json;
          float_enabled: boolean;
          profile_name: string;
          scheduling_mode: Database['public']['Enums']['scheduling_mode_enum'];
          shift_end_bound: string;
          shift_start_bound: string;
        };
        Insert: {
          claim_phase_alert_offset?: string | null;
          claim_phase_close_offset?: string | null;
          claim_phase_open_offset?: string | null;
          default_cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          default_hours_cap: number;
          escalation_chain: Json;
          float_enabled: boolean;
          profile_name: string;
          scheduling_mode: Database['public']['Enums']['scheduling_mode_enum'];
          shift_end_bound: string;
          shift_start_bound: string;
        };
        Update: {
          claim_phase_alert_offset?: string | null;
          claim_phase_close_offset?: string | null;
          claim_phase_open_offset?: string | null;
          default_cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          default_hours_cap?: number;
          escalation_chain?: Json;
          float_enabled?: boolean;
          profile_name?: string;
          scheduling_mode?: Database['public']['Enums']['scheduling_mode_enum'];
          shift_end_bound?: string;
          shift_start_bound?: string;
        };
        Relationships: [];
      };
      operating_seasons: {
        Row: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          created_at: string;
          created_by: string | null;
          end_date: string;
          hours_cap: number;
          last_applied_at: string | null;
          preference_deadline: string | null;
          scheduling_mode: Database['public']['Enums']['scheduling_mode_enum'];
          season_id: string;
          season_name: string;
          shift_end_bound: string;
          shift_start_bound: string;
          slug: string;
          start_date: string;
        };
        Insert: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          created_at?: string;
          created_by?: string | null;
          end_date: string;
          hours_cap: number;
          last_applied_at?: string | null;
          preference_deadline?: string | null;
          scheduling_mode?: Database['public']['Enums']['scheduling_mode_enum'];
          season_id?: string;
          season_name: string;
          shift_end_bound?: string;
          shift_start_bound?: string;
          slug: string;
          start_date: string;
        };
        Update: {
          cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          created_at?: string;
          created_by?: string | null;
          end_date?: string;
          hours_cap?: number;
          last_applied_at?: string | null;
          preference_deadline?: string | null;
          scheduling_mode?: Database['public']['Enums']['scheduling_mode_enum'];
          season_id?: string;
          season_name?: string;
          shift_end_bound?: string;
          shift_start_bound?: string;
          slug?: string;
          start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operating_seasons_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'operating_seasons_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'operating_seasons_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      orchestrator_health: {
        Row: {
          blocks_scanned: number;
          errors: string[];
          floats_voided: number;
          last_tick_at: string;
          singleton: boolean;
          steps_fired: number;
          swaps_expired: number;
        };
        Insert: {
          blocks_scanned?: number;
          errors?: string[];
          floats_voided?: number;
          last_tick_at: string;
          singleton?: boolean;
          steps_fired?: number;
          swaps_expired?: number;
        };
        Update: {
          blocks_scanned?: number;
          errors?: string[];
          floats_voided?: number;
          last_tick_at?: string;
          singleton?: boolean;
          steps_fired?: number;
          swaps_expired?: number;
        };
        Relationships: [];
      };
      period_house_publications: {
        Row: {
          house_id: string;
          period_id: string;
          published_at: string;
          published_by: string | null;
        };
        Insert: {
          house_id: string;
          period_id: string;
          published_at?: string;
          published_by?: string | null;
        };
        Update: {
          house_id?: string;
          period_id?: string;
          published_at?: string;
          published_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'period_house_publications_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'period_house_publications_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'period_house_publications_period_id_fkey';
            columns: ['period_id'];
            isOneToOne: false;
            referencedRelation: 'scheduling_periods';
            referencedColumns: ['period_id'];
          },
          {
            foreignKeyName: 'period_house_publications_published_by_fkey';
            columns: ['published_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'period_house_publications_published_by_fkey';
            columns: ['published_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'period_house_publications_published_by_fkey';
            columns: ['published_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      period_targets: {
        Row: {
          opted_out: boolean;
          period_id: string;
          target_hours: number;
          user_id: string;
        };
        Insert: {
          opted_out?: boolean;
          period_id: string;
          target_hours: number;
          user_id: string;
        };
        Update: {
          opted_out?: boolean;
          period_id?: string;
          target_hours?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'period_targets_period_id_fkey';
            columns: ['period_id'];
            isOneToOne: false;
            referencedRelation: 'scheduling_periods';
            referencedColumns: ['period_id'];
          },
          {
            foreignKeyName: 'period_targets_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'period_targets_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'period_targets_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      preference_reminder_sends: {
        Row: {
          notification_id: string;
          period_id: string;
          sent_at: string;
          threshold_days: number;
          user_id: string;
        };
        Insert: {
          notification_id?: string;
          period_id: string;
          sent_at?: string;
          threshold_days: number;
          user_id: string;
        };
        Update: {
          notification_id?: string;
          period_id?: string;
          sent_at?: string;
          threshold_days?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'preference_reminder_sends_period_id_fkey';
            columns: ['period_id'];
            isOneToOne: false;
            referencedRelation: 'scheduling_periods';
            referencedColumns: ['period_id'];
          },
          {
            foreignKeyName: 'preference_reminder_sends_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'preference_reminder_sends_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'preference_reminder_sends_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      preferences: {
        Row: {
          block_id: string;
          period_id: string;
          status: Database['public']['Enums']['preference_status_enum'];
          user_id: string;
        };
        Insert: {
          block_id: string;
          period_id: string;
          status: Database['public']['Enums']['preference_status_enum'];
          user_id: string;
        };
        Update: {
          block_id?: string;
          period_id?: string;
          status?: Database['public']['Enums']['preference_status_enum'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'preferences_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'house_schedule_grid';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'preferences_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'preferences_period_id_fkey';
            columns: ['period_id'];
            isOneToOne: false;
            referencedRelation: 'scheduling_periods';
            referencedColumns: ['period_id'];
          },
          {
            foreignKeyName: 'preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      push_tokens: {
        Row: {
          created_at: string;
          device_token: string;
          last_used_at: string | null;
          platform: string;
          push_token_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          device_token: string;
          last_used_at?: string | null;
          platform: string;
          push_token_id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          device_token?: string;
          last_used_at?: string | null;
          platform?: string;
          push_token_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'push_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'push_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      routing_rules: {
        Row: {
          active: boolean;
          created_at: string;
          day_type: string;
          issue_type: string;
          notes: string | null;
          priority: number;
          rule_id: string;
          season_scope: string;
          tier: string;
          updated_at: string;
          window_end: string | null;
          window_start: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          day_type?: string;
          issue_type: string;
          notes?: string | null;
          priority?: number;
          rule_id?: string;
          season_scope?: string;
          tier: string;
          updated_at?: string;
          window_end?: string | null;
          window_start?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          day_type?: string;
          issue_type?: string;
          notes?: string | null;
          priority?: number;
          rule_id?: string;
          season_scope?: string;
          tier?: string;
          updated_at?: string;
          window_end?: string | null;
          window_start?: string | null;
        };
        Relationships: [];
      };
      scheduling_periods: {
        Row: {
          end_date: string;
          period_id: string;
          period_name: string;
          preference_deadline: string | null;
          profile_name: string;
          published_at: string | null;
          start_date: string;
        };
        Insert: {
          end_date: string;
          period_id?: string;
          period_name: string;
          preference_deadline?: string | null;
          profile_name: string;
          published_at?: string | null;
          start_date: string;
        };
        Update: {
          end_date?: string;
          period_id?: string;
          period_name?: string;
          preference_deadline?: string | null;
          profile_name?: string;
          published_at?: string | null;
          start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scheduling_periods_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      season_float_windows: {
        Row: {
          end_date: string;
          season_id: string;
          start_date: string;
          window_id: string;
        };
        Insert: {
          end_date: string;
          season_id: string;
          start_date: string;
          window_id?: string;
        };
        Update: {
          end_date?: string;
          season_id?: string;
          start_date?: string;
          window_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'season_float_windows_season_id_fkey';
            columns: ['season_id'];
            isOneToOne: false;
            referencedRelation: 'operating_seasons';
            referencedColumns: ['season_id'];
          },
        ];
      };
      season_house_windows: {
        Row: {
          end_date: string;
          house_id: string;
          season_id: string;
          start_date: string;
          weekday_bands: Json;
          weekend_bands: Json;
          window_id: string;
        };
        Insert: {
          end_date: string;
          house_id: string;
          season_id: string;
          start_date: string;
          weekday_bands?: Json;
          weekend_bands?: Json;
          window_id?: string;
        };
        Update: {
          end_date?: string;
          house_id?: string;
          season_id?: string;
          start_date?: string;
          weekday_bands?: Json;
          weekend_bands?: Json;
          window_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'season_house_windows_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'season_house_windows_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'season_house_windows_season_id_fkey';
            columns: ['season_id'];
            isOneToOne: false;
            referencedRelation: 'operating_seasons';
            referencedColumns: ['season_id'];
          },
        ];
      };
      shift_block_assignments: {
        Row: {
          assignment_id: string;
          block_id: string;
          dropped_at: string | null;
          dropped_by_user_id: string | null;
          is_cross_house_pickup: boolean;
          is_float: boolean;
          parent_float_id: string | null;
          source_house_id: string | null;
          status: Database['public']['Enums']['shift_status_enum'];
          user_id: string | null;
          vacancy_origin: Database['public']['Enums']['vacancy_origin_enum'];
        };
        Insert: {
          assignment_id?: string;
          block_id: string;
          dropped_at?: string | null;
          dropped_by_user_id?: string | null;
          is_cross_house_pickup?: boolean;
          is_float?: boolean;
          parent_float_id?: string | null;
          source_house_id?: string | null;
          status: Database['public']['Enums']['shift_status_enum'];
          user_id?: string | null;
          vacancy_origin?: Database['public']['Enums']['vacancy_origin_enum'];
        };
        Update: {
          assignment_id?: string;
          block_id?: string;
          dropped_at?: string | null;
          dropped_by_user_id?: string | null;
          is_cross_house_pickup?: boolean;
          is_float?: boolean;
          parent_float_id?: string | null;
          source_house_id?: string | null;
          status?: Database['public']['Enums']['shift_status_enum'];
          user_id?: string | null;
          vacancy_origin?: Database['public']['Enums']['vacancy_origin_enum'];
        };
        Relationships: [
          {
            foreignKeyName: 'shift_block_assignments_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'house_schedule_grid';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_dropped_by_user_id_fkey';
            columns: ['dropped_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_dropped_by_user_id_fkey';
            columns: ['dropped_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_dropped_by_user_id_fkey';
            columns: ['dropped_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_parent_float_id_fkey';
            columns: ['parent_float_id'];
            isOneToOne: false;
            referencedRelation: 'float_assignments';
            referencedColumns: ['float_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_parent_float_id_fkey';
            columns: ['parent_float_id'];
            isOneToOne: false;
            referencedRelation: 'worker_pending_floats';
            referencedColumns: ['float_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_parent_float_id_fkey';
            columns: ['parent_float_id'];
            isOneToOne: false;
            referencedRelation: 'worker_recent_floats';
            referencedColumns: ['float_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_source_house_id_fkey';
            columns: ['source_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_source_house_id_fkey';
            columns: ['source_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      shift_blocks: {
        Row: {
          block_id: string;
          block_start_at: string;
          coverage_locked_at: string | null;
          house_id: string;
          required_headcount: number;
          voided_at: string | null;
        };
        Insert: {
          block_id?: string;
          block_start_at: string;
          coverage_locked_at?: string | null;
          house_id: string;
          required_headcount: number;
          voided_at?: string | null;
        };
        Update: {
          block_id?: string;
          block_start_at?: string;
          coverage_locked_at?: string | null;
          house_id?: string;
          required_headcount?: number;
          voided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      shift_reminder_sends: {
        Row: {
          enqueued_at: string;
          first_assignment_id: string;
          notification_id: string;
          offset_minutes: number;
          shift_start_at: string;
          user_id: string;
        };
        Insert: {
          enqueued_at?: string;
          first_assignment_id: string;
          notification_id?: string;
          offset_minutes: number;
          shift_start_at: string;
          user_id: string;
        };
        Update: {
          enqueued_at?: string;
          first_assignment_id?: string;
          notification_id?: string;
          offset_minutes?: number;
          shift_start_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_reminder_sends_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_reminder_sends_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_reminder_sends_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      staffing_patterns: {
        Row: {
          block_headcounts: Json;
          day_type: Database['public']['Enums']['day_type_enum'];
          house_id: string;
          profile_name: string;
        };
        Insert: {
          block_headcounts: Json;
          day_type: Database['public']['Enums']['day_type_enum'];
          house_id: string;
          profile_name: string;
        };
        Update: {
          block_headcounts?: Json;
          day_type?: Database['public']['Enums']['day_type_enum'];
          house_id?: string;
          profile_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staffing_patterns_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staffing_patterns_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staffing_patterns_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      swap_requests: {
        Row: {
          counterparty_assignment_ids: string[] | null;
          counterparty_user_id: string;
          created_at: string;
          expires_at: string;
          initiator_assignment_ids: string[];
          initiator_user_id: string;
          recurring_pattern: Json | null;
          status: Database['public']['Enums']['swap_status_enum'];
          swap_id: string;
          swap_type: Database['public']['Enums']['swap_type_enum'];
        };
        Insert: {
          counterparty_assignment_ids?: string[] | null;
          counterparty_user_id: string;
          created_at?: string;
          expires_at: string;
          initiator_assignment_ids: string[];
          initiator_user_id: string;
          recurring_pattern?: Json | null;
          status?: Database['public']['Enums']['swap_status_enum'];
          swap_id?: string;
          swap_type: Database['public']['Enums']['swap_type_enum'];
        };
        Update: {
          counterparty_assignment_ids?: string[] | null;
          counterparty_user_id?: string;
          created_at?: string;
          expires_at?: string;
          initiator_assignment_ids?: string[];
          initiator_user_id?: string;
          recurring_pattern?: Json | null;
          status?: Database['public']['Enums']['swap_status_enum'];
          swap_id?: string;
          swap_type?: Database['public']['Enums']['swap_type_enum'];
        };
        Relationships: [
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['counterparty_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['counterparty_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['counterparty_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'swap_requests_initiator_user_id_fkey';
            columns: ['initiator_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_initiator_user_id_fkey';
            columns: ['initiator_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_initiator_user_id_fkey';
            columns: ['initiator_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      system_config: {
        Row: {
          config_key: string;
          config_value: string;
          modified_at: string;
          modified_by: string | null;
          notes: string | null;
          value_type: Database['public']['Enums']['value_type_enum'];
        };
        Insert: {
          config_key: string;
          config_value: string;
          modified_at?: string;
          modified_by?: string | null;
          notes?: string | null;
          value_type: Database['public']['Enums']['value_type_enum'];
        };
        Update: {
          config_key?: string;
          config_value?: string;
          modified_at?: string;
          modified_by?: string | null;
          notes?: string | null;
          value_type?: Database['public']['Enums']['value_type_enum'];
        };
        Relationships: [
          {
            foreignKeyName: 'system_config_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'system_config_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'system_config_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      user_house_memberships: {
        Row: {
          applied_at: string | null;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          effective_to: string | null;
          house_id: string;
          membership_id: string;
          note: string | null;
          user_id: string;
        };
        Insert: {
          applied_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          effective_to?: string | null;
          house_id: string;
          membership_id?: string;
          note?: string | null;
          user_id: string;
        };
        Update: {
          applied_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          effective_to?: string | null;
          house_id?: string;
          membership_id?: string;
          note?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_house_memberships_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'user_house_memberships_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'user_house_memberships_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'user_house_memberships_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_house_memberships_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_house_memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'user_house_memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'user_house_memberships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      user_roles: {
        Row: {
          role: Database['public']['Enums']['user_role_enum'];
          scope_house_id: string | null;
          user_id: string;
        };
        Insert: {
          role: Database['public']['Enums']['user_role_enum'];
          scope_house_id?: string | null;
          user_id: string;
        };
        Update: {
          role?: Database['public']['Enums']['user_role_enum'];
          scope_house_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_roles_scope_house_id_fkey';
            columns: ['scope_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_roles_scope_house_id_fkey';
            columns: ['scope_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_roles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'user_roles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'user_roles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      users: {
        Row: {
          broadcast_subscribed: boolean;
          email: string;
          home_house_id: string;
          is_active: boolean;
          name: string;
          phone: string | null;
          user_id: string;
        };
        Insert: {
          broadcast_subscribed?: boolean;
          email: string;
          home_house_id: string;
          is_active?: boolean;
          name: string;
          phone?: string | null;
          user_id: string;
        };
        Update: {
          broadcast_subscribed?: boolean;
          email?: string;
          home_house_id?: string;
          is_active?: boolean;
          name?: string;
          phone?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['home_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['home_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      weekly_cap_overrides: {
        Row: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
          modified_at: string;
          modified_by: string | null;
          notes: string | null;
          week_start_date: string;
        };
        Insert: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
          modified_at?: string;
          modified_by?: string | null;
          notes?: string | null;
          week_start_date: string;
        };
        Update: {
          cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap?: number;
          modified_at?: string;
          modified_by?: string | null;
          notes?: string | null;
          week_start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'weekly_cap_overrides_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'weekly_cap_overrides_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'weekly_cap_overrides_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
    };
    Views: {
      dead_lettered_notifications: {
        Row: {
          created_at: string | null;
          dead_lettered_at: string | null;
          delivery_attempts: number | null;
          last_attempt_at: string | null;
          last_delivery_error: string | null;
          notification_id: string | null;
          recipient_user_id: string | null;
          type: Database['public']['Enums']['notification_type'] | null;
        };
        Insert: {
          created_at?: string | null;
          dead_lettered_at?: string | null;
          delivery_attempts?: number | null;
          last_attempt_at?: string | null;
          last_delivery_error?: string | null;
          notification_id?: string | null;
          recipient_user_id?: string | null;
          type?: Database['public']['Enums']['notification_type'] | null;
        };
        Update: {
          created_at?: string | null;
          dead_lettered_at?: string | null;
          delivery_attempts?: number | null;
          last_attempt_at?: string | null;
          last_delivery_error?: string | null;
          notification_id?: string | null;
          recipient_user_id?: string | null;
          type?: Database['public']['Enums']['notification_type'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notifications_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'notifications_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      house_schedule_grid: {
        Row: {
          block_id: string | null;
          desk_phone: string | null;
          end_at: string | null;
          house_id: string | null;
          house_name: string | null;
          id: string | null;
          is_cross_house_pickup: boolean | null;
          is_float: boolean | null;
          required_headcount: number | null;
          start_at: string | null;
          status: string | null;
          user_id: string | null;
          worker_email: string | null;
          worker_home_house_id: string | null;
          worker_home_house_name: string | null;
          worker_name: string | null;
          worker_phone: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['worker_home_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['worker_home_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      house_schedule_grid_any: {
        Row: {
          desk_phone: string | null;
          end_at: string | null;
          house_id: string | null;
          house_name: string | null;
          id: string | null;
          is_cross_house_pickup: boolean | null;
          is_float: boolean | null;
          start_at: string | null;
          status: string | null;
          user_id: string | null;
          worker_email: string | null;
          worker_home_house_id: string | null;
          worker_home_house_name: string | null;
          worker_name: string | null;
          worker_phone: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['worker_home_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['worker_home_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      pending_swap_seat_marks: {
        Row: {
          assignment_id: string | null;
          awaiting_name: string | null;
          awaiting_user_id: string | null;
          counterparty_name: string | null;
          counterparty_span: string | null;
          counterparty_user_id: string | null;
          created_at: string | null;
          expires_at: string | null;
          initiator_name: string | null;
          initiator_span: string | null;
          initiator_user_id: string | null;
          side: string | null;
          status: string | null;
          swap_id: string | null;
          swap_type: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['counterparty_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['awaiting_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['counterparty_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['awaiting_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['counterparty_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'swap_requests_counterparty_user_id_fkey';
            columns: ['awaiting_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'swap_requests_initiator_user_id_fkey';
            columns: ['initiator_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_initiator_user_id_fkey';
            columns: ['initiator_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'swap_requests_initiator_user_id_fkey';
            columns: ['initiator_user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
        ];
      };
      worker_directory: {
        Row: {
          email: string | null;
          home_house_id: string | null;
          is_active: boolean | null;
          name: string | null;
          phone: string | null;
          user_id: string | null;
        };
        Insert: {
          email?: string | null;
          home_house_id?: string | null;
          is_active?: boolean | null;
          name?: string | null;
          phone?: string | null;
          user_id?: string | null;
        };
        Update: {
          email?: string | null;
          home_house_id?: string | null;
          is_active?: boolean | null;
          name?: string | null;
          phone?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['home_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'users_home_house_id_fkey';
            columns: ['home_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      worker_my_shifts: {
        Row: {
          break_shift: boolean | null;
          cross_house: boolean | null;
          dropped_still_open: boolean | null;
          end_at: string | null;
          house_id: string | null;
          house_name: string | null;
          id: string | null;
          kind: string | null;
          pending: boolean | null;
          start_at: string | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      worker_open_shifts: {
        Row: {
          coverage_locked: boolean | null;
          desk_covered: boolean | null;
          eligible_user_id: string | null;
          end_at: string | null;
          feed: string | null;
          home_house: boolean | null;
          house_id: string | null;
          house_name: string | null;
          id: string | null;
          start_at: string | null;
          weeks_remaining: number | null;
        };
        Relationships: [];
      };
      worker_pending_floats: {
        Row: {
          block_count: number | null;
          created_at: string | null;
          destination_house_id: string | null;
          destination_house_name: string | null;
          float_end: string | null;
          float_id: string | null;
          float_start: string | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      worker_recent_floats: {
        Row: {
          destination_house_id: string | null;
          destination_house_name: string | null;
          float_end: string | null;
          float_id: string | null;
          float_start: string | null;
          resolved_at: string | null;
          status: string | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_directory';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'worker_open_shifts';
            referencedColumns: ['eligible_user_id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'worker_visible_houses';
            referencedColumns: ['id'];
          },
        ];
      };
      worker_visible_houses: {
        Row: {
          desk_phone: string | null;
          id: string | null;
          launch_state: string | null;
          name: string | null;
        };
        Insert: {
          desk_phone?: string | null;
          id?: string | null;
          launch_state?: string | null;
          name?: string | null;
        };
        Update: {
          desk_phone?: string | null;
          id?: string | null;
          launch_state?: string | null;
          name?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_swap: {
        Args: { p_accepting_user_id: string; p_now?: string; p_swap_id: string };
        Returns: Json;
      };
      acknowledge_allied_coverage_request: {
        Args: { p_now: string; p_request_id: string; p_user_id: string };
        Returns: Json;
      };
      acknowledge_allied_page: {
        Args: { p_block_id: string; p_now: string; p_user_id: string };
        Returns: Json;
      };
      acknowledge_float: {
        Args: { p_float_id: string; p_now?: string; p_user_id: string };
        Returns: Json;
      };
      admin_assign_worker: {
        Args: {
          p_block_ids: string[];
          p_incumbent_user_id?: string;
          p_now: string;
          p_operator_user_id: string;
          p_override_advisories: boolean;
          p_scope: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      admin_override_cap_assessment: {
        Args: { p_block_ids: string[]; p_user_id: string };
        Returns: {
          over_hard: boolean;
          over_soft: boolean;
        }[];
      };
      admin_remove_worker: {
        Args: {
          p_block_ids: string[];
          p_now: string;
          p_operator_user_id: string;
          p_scope: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      admin_seed_draft_schedule: {
        Args: {
          p_actor_user_id: string;
          p_house_id: string;
          p_period_id: string;
          p_rows: Json;
        };
        Returns: Json;
      };
      admin_seed_preferences: {
        Args: { p_actor_user_id: string; p_period_id: string; p_rows: Json };
        Returns: Json;
      };
      admin_submit_preferences: {
        Args: {
          p_actor_user_id: string;
          p_opted_out?: boolean;
          p_period_id: string;
          p_preferences: Json;
          p_target_hours: number;
          p_target_user_id: string;
        };
        Returns: {
          preferences_upserted: number;
          target_upserted: number;
        }[];
      };
      advance_allied_coverage_ladder: {
        Args: { p_limit?: number; p_now: string };
        Returns: Json;
      };
      advance_offhours_allied_ladder: {
        Args: { p_now: string; p_timeout_minutes?: number };
        Returns: number;
      };
      allied_ladder_next_manager_rung: {
        Args: { p_rung: string };
        Returns: string;
      };
      allied_ladder_next_rung: { Args: { p_rung: string }; Returns: string };
      allied_ladder_reminder_minutes: { Args: never; Returns: number };
      allied_ladder_rung_timeout_minutes: { Args: never; Returns: number };
      app_now: { Args: never; Returns: string };
      app_runtime_setting: { Args: { p_name: string }; Returns: string };
      apply_compiled_break: {
        Args: {
          p_calling_user_id: string;
          p_dry_run?: boolean;
          p_payload: Json;
        };
        Returns: Json;
      };
      apply_compiled_season: {
        Args: {
          p_calling_user_id: string;
          p_dry_run?: boolean;
          p_payload: Json;
          p_season_id: string;
        };
        Returns: Json;
      };
      apply_compiled_season_unguarded: {
        Args: {
          p_calling_user_id: string;
          p_dry_run?: boolean;
          p_payload: Json;
          p_season_id: string;
        };
        Returns: Json;
      };
      apply_due_house_transfers: { Args: never; Returns: number };
      apply_house_transfer: {
        Args: { p_membership_id: string; p_now?: string };
        Returns: Json;
      };
      apply_permanent_swap: {
        Args: {
          p_affected_assignment_ids: string[];
          p_new_owner_user_id: string;
          p_now?: string;
          p_swap_id: string;
        };
        Returns: Json;
      };
      assignments_outside_regular_school_year: {
        Args: { p_assignment_ids: string[] };
        Returns: string[];
      };
      assistant_my_shifts: {
        Args: { p_from: string; p_to: string; p_user_id: string };
        Returns: {
          block_count: number;
          break_shift: boolean;
          cross_house: boolean;
          end_at: string;
          hours: number;
          house_id: string;
          house_name: string;
          kind: string;
          start_at: string;
        }[];
      };
      author_break_period: {
        Args: {
          p_actor_user_id: string;
          p_break_id?: string;
          p_break_name: string;
          p_break_type: Database['public']['Enums']['break_type_enum'];
          p_end_date: string;
          p_profile_name: string;
          p_start_date: string;
        };
        Returns: {
          dates_declared: number;
          new_break_id: string;
        }[];
      };
      begin_notification_delivery_attempt: {
        Args: { p_notification_id: string; p_now: string };
        Returns: number;
      };
      block_has_escalation_coverage: {
        Args: { p_block_id: string };
        Returns: boolean;
      };
      block_has_present_worker: {
        Args: { p_block_id: string };
        Returns: boolean;
      };
      break_claim_calendar_pool: {
        Args: { p_as_of?: string; p_house_id: string };
        Returns: {
          assignment_id: string;
          block_id: string;
          dropped_at: string | null;
          dropped_by_user_id: string | null;
          is_cross_house_pickup: boolean;
          is_float: boolean;
          parent_float_id: string | null;
          source_house_id: string | null;
          status: Database['public']['Enums']['shift_status_enum'];
          user_id: string | null;
          vacancy_origin: Database['public']['Enums']['vacancy_origin_enum'];
        }[];
        SetofOptions: {
          from: '*';
          to: 'shift_block_assignments';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      break_claim_phase: {
        Args: { p_as_of: string; p_break_id: string };
        Returns: string;
      };
      break_is_highlighted: {
        Args: { p_as_of: string; p_break_id: string };
        Returns: boolean;
      };
      claim_break_blocks: {
        Args: { p_as_of: string; p_block_ids: string[]; p_user_id: string };
        Returns: {
          claimed_assignment_id: string;
          claimed_block_id: string;
        }[];
      };
      claim_break_shift: {
        Args: { p_as_of: string; p_assignment_id: string; p_user_id: string };
        Returns: string;
      };
      claim_hours_projection: {
        Args: { p_assignment_id: string; p_user_id: string };
        Returns: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          current_hours: number;
          hours_cap: number;
          projected_hours: number;
          soft_cap_warning: boolean;
        }[];
      };
      claim_open_shift: {
        Args: { p_as_of: string; p_assignment_id: string; p_user_id: string };
        Returns: string;
      };
      clear_break_period: { Args: { p_break_id: string }; Returns: number };
      close_allied_coverage_request: {
        Args: {
          p_note: string;
          p_now: string;
          p_outcome: Database['public']['Enums']['allied_coverage_outcome'];
          p_request_id: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      close_break_claim_pool: { Args: { p_break_id: string }; Returns: number };
      commit_kb_intake: {
        Args: {
          p_allowed_roles: string[];
          p_chunks: Json;
          p_effective_from: string;
          p_effective_until: string;
          p_house_scope: string[];
          p_intake_id: string;
          p_metrics: Json;
          p_sensitivity: Database['public']['Enums']['da_sensitivity_enum'];
          p_source_ref: string;
          p_source_type: Database['public']['Enums']['da_source_type_enum'];
          p_temporality: Database['public']['Enums']['da_temporality_enum'];
          p_title: string;
        };
        Returns: Json;
      };
      craft_hm_leave_mailto: { Args: { p_leave_id: string }; Returns: string };
      craft_hm_return_mailto: { Args: { p_leave_id: string }; Returns: string };
      da_can_read_item: {
        Args: {
          check_user_id: string;
          p_allowed_roles: string[];
          p_house_scope: string[];
          p_sensitivity: Database['public']['Enums']['da_sensitivity_enum'];
        };
        Returns: boolean;
      };
      da_is_kb_admin: { Args: { check_user_id: string }; Returns: boolean };
      decline_float: {
        Args: { p_float_id: string; p_now?: string; p_user_id: string };
        Returns: Json;
      };
      deliver_notification: {
        Args: { p_notification_id: string; p_now: string };
        Returns: boolean;
      };
      deliver_pending_notifications: { Args: never; Returns: number };
      drop_shift: {
        Args: {
          p_as_of?: string;
          p_assignment_ids: string[];
          p_user_id: string;
        };
        Returns: {
          direct_hmod_notification: boolean;
          dropped_assignment_ids: string[];
          short_notice_warning: boolean;
        }[];
      };
      effective_weekly_cap: {
        Args: { p_block_start_at: string; p_week_start_date: string };
        Returns: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
        }[];
      };
      effective_weekly_caps: {
        Args: { p_from_week_start: string; p_to_week_start: string };
        Returns: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
          week_start_date: string;
        }[];
      };
      emit_allied_coverage_notification: {
        Args: { p_now: string; p_request_id: string };
        Returns: string;
      };
      emit_allied_page_notifications: {
        Args: {
          p_block_id: string;
          p_block_start_at: string;
          p_house_id: string;
          p_now: string;
          p_reason: string;
          p_recipients: string[];
          p_rung: string;
        };
        Returns: undefined;
      };
      end_hm_leave_early: {
        Args: { p_leave_id: string; p_now: string; p_user_id: string };
        Returns: string;
      };
      enqueue_shift_reminders: {
        Args: { p_lookahead?: string; p_now?: string };
        Returns: number;
      };
      execute_due_break_transitions: { Args: never; Returns: number };
      expire_pending_swaps: { Args: { p_now: string }; Returns: number };
      expire_pending_swaps_if_uncronned: {
        Args: { p_now: string };
        Returns: number;
      };
      fire_worker: {
        Args: { p_initiator: string; p_now?: string; p_user_id: string };
        Returns: Json;
      };
      first_uncovered_date_for_house: {
        Args: { p_end_date: string; p_house_id: string; p_start_date: string };
        Returns: string;
      };
      flag_leave_depth_error: {
        Args: {
          p_chain: string[];
          p_house_id: string;
          p_leaving_user_id: string;
          p_now: string;
        };
        Returns: string;
      };
      force_trigger_float: {
        Args: {
          p_destination_assignment_ids: string[];
          p_destination_house_id: string;
          p_initiator_user_id: string;
          p_now?: string;
          p_retention_days?: number;
          p_source_assignment_ids: string[];
          p_source_house_id: string;
          p_worker_id: string;
        };
        Returns: Json;
      };
      format_swap_span: {
        Args: { p_assignment_ids: string[] };
        Returns: string;
      };
      generate_blocks_for_date: {
        Args: { target_date: string };
        Returns: {
          assignments_inserted: number;
          blocks_inserted: number;
        }[];
      };
      generate_blocks_for_range: {
        Args: { end_date: string; start_date: string };
        Returns: {
          assignments_inserted: number;
          blocks_inserted: number;
        }[];
      };
      hire_worker: {
        Args: {
          p_email: string;
          p_home_house_id: string;
          p_initiator: string;
          p_name: string;
          p_phone?: string;
          p_role?: Database['public']['Enums']['user_role_enum'];
          p_user_id: string;
        };
        Returns: Json;
      };
      hmod_interval_start_date: { Args: { p_at: string }; Returns: string };
      house_closure: {
        Args: { p_house_id: string; p_on_date: string };
        Returns: boolean;
      };
      house_has_open_leave_config_error: {
        Args: { p_house_id: string };
        Returns: boolean;
      };
      house_is_live: { Args: { p_house_id: string }; Returns: boolean };
      house_is_staffable: { Args: { p_house_id: string }; Returns: boolean };
      house_roster_as_of: {
        Args: { p_as_of: string; p_house_id: string };
        Returns: {
          is_rsm: boolean;
          name: string;
          user_id: string;
        }[];
      };
      is_assignment_claimable: {
        Args: { p_as_of: string; p_assignment_id: string };
        Returns: boolean;
      };
      is_hm_working_time: { Args: { p_at: string }; Returns: boolean };
      is_offhours_ladder_enabled: { Args: never; Returns: boolean };
      is_project_administrator: {
        Args: { check_user_id: string };
        Returns: boolean;
      };
      is_staggered_launch_enabled: { Args: never; Returns: boolean };
      is_valid_block_headcounts: { Args: { p: Json }; Returns: boolean };
      is_valid_escalation_chain: { Args: { p: Json }; Returns: boolean };
      is_valid_shift_reminder_offsets: {
        Args: { p_offsets: number[] };
        Returns: boolean;
      };
      leave_resolution_walk: {
        Args: { p_resolution_date: string; p_user_id: string };
        Returns: Record<string, unknown>;
      };
      lock_block_coverage: {
        Args: { p_as_of: string; p_block_id: string };
        Returns: boolean;
      };
      mark_notification_read: {
        Args: { p_notification_id: string; p_now: string; p_user_id: string };
        Returns: boolean;
      };
      match_kb_chunks: {
        Args: {
          p_as_of?: string;
          p_query_embedding: string;
          p_top_k?: number;
          p_user_id: string;
        };
        Returns: {
          allowed_roles: string[];
          chunk_id: string;
          content: string;
          document_id: string;
          effective_from: string;
          effective_until: string;
          house_scope: string[];
          sensitivity: Database['public']['Enums']['da_sensitivity_enum'];
          similarity: number;
          source_ref: string;
          source_updated_at: string;
          temporality: Database['public']['Enums']['da_temporality_enum'];
        }[];
      };
      max_notification_delivery_attempts: { Args: never; Returns: number };
      membership_house_for_date: {
        Args: { p_date: string; p_user_id: string };
        Returns: string;
      };
      notification_is_pushable: {
        Args: { p_type: Database['public']['Enums']['notification_type'] };
        Returns: boolean;
      };
      notification_push_targets: {
        Args: { p_user_id: string };
        Returns: {
          created_at: string;
          device_token: string;
          last_used_at: string | null;
          platform: string;
          push_token_id: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'push_tokens';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      notification_retry_backoff: {
        Args: { p_attempts: number };
        Returns: string;
      };
      offhours_ladder_timeout_minutes: { Args: never; Returns: number };
      open_allied_coverage_request: {
        Args: {
          p_block_id: string;
          p_house_id: string;
          p_now: string;
          p_reason: string;
          p_window_end_at: string;
          p_window_start_at: string;
        };
        Returns: Json;
      };
      open_break_claim_calendar: {
        Args: { p_break_id: string; p_house_id: string };
        Returns: number;
      };
      operational_retention_days: { Args: never; Returns: number };
      orchestrator_vacant_seats: {
        Args: { p_after: string; p_through: string };
        Returns: {
          assignment_id: string;
          block_id: string;
          block_start_at: string;
          desk_covered: boolean;
          house_id: string;
        }[];
      };
      pending_floats_due_for_no_ack: {
        Args: { p_lookahead_minutes: number; p_now: string };
        Returns: {
          earliest_destination_start: string;
          float_id: string;
        }[];
      };
      pending_notification_deliveries: {
        Args: { p_now: string };
        Returns: {
          acknowledged_at: string | null;
          created_at: string;
          dead_lettered_at: string | null;
          delivered_at: string | null;
          delivery_attempts: number;
          last_attempt_at: string | null;
          last_delivery_error: string | null;
          notification_id: string;
          payload: Json;
          recipient_user_id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          scheduled_for: string | null;
          suppressed_at: string | null;
          type: Database['public']['Enums']['notification_type'];
        }[];
        SetofOptions: {
          from: '*';
          to: 'notifications';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      permanent_drop: {
        Args: {
          drop_initiated_at: string;
          dropping_user_id: string;
          slot_block_start_times: string[];
          slot_day_of_week: number;
          slot_house_id: string;
        };
        Returns: number;
      };
      permanent_drop_slot: {
        Args: {
          p_block_start_locals: string[];
          p_day_of_week: number;
          p_drop_initiated_at: string;
          p_dropping_user_id: string;
          p_house_id: string;
          p_operator_user_id?: string;
        };
        Returns: Json;
      };
      permanent_openings_feed: {
        Args: { p_as_of?: string; p_house_id: string };
        Returns: {
          block_start_time: string;
          day_of_week: number;
          house_id: string;
          weeks_remaining: number;
        }[];
      };
      permanent_pickup_slot: {
        Args: {
          p_assigned_block_ids: string[];
          p_picking_user_id: string;
          p_skipped_block_ids?: string[];
        };
        Returns: Json;
      };
      preference_deadline_is_open: {
        Args: { check_period_id: string };
        Returns: boolean;
      };
      process_broadcast_step: {
        Args: {
          p_block_id: string;
          p_block_start_at: string;
          p_house_id: string;
          p_now: string;
        };
        Returns: Json;
      };
      process_float_lookup_assignment: {
        Args: {
          p_destination_assignment_ids: string[];
          p_destination_house_id: string;
          p_now: string;
          p_retention_days?: number;
          p_source_assignment_ids: string[];
          p_source_house_id: string;
          p_worker_id: string;
        };
        Returns: Json;
      };
      process_hmod_notify_allied_step: {
        Args: {
          p_block_id: string;
          p_block_start_at: string;
          p_house_id: string;
          p_now: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      process_no_ack_float: {
        Args: {
          p_float_id: string;
          p_lookahead_minutes?: number;
          p_now: string;
        };
        Returns: Json;
      };
      publish_schedule: {
        Args: {
          p_house_id: string;
          p_period_id: string;
          p_published_by: string;
        };
        Returns: number;
      };
      purge_expired_operational_records: {
        Args: { p_now?: string };
        Returns: {
          floats_deleted: number;
          notifications_deleted: number;
        }[];
      };
      reconcile_config_blocks: {
        Args: { p_end: string; p_start: string };
        Returns: Json;
      };
      reconcile_float_source_release: {
        Args: { p_float_id: string };
        Returns: undefined;
      };
      record_notification_delivery_failure: {
        Args: { p_error: string; p_notification_id: string; p_now: string };
        Returns: boolean;
      };
      remove_break_period: {
        Args: { p_actor_user_id: string; p_break_id: string };
        Returns: Json;
      };
      reopen_float_source_seats: {
        Args: { p_float_id: string; p_source_assignment_ids: string[] };
        Returns: number;
      };
      resolve_allied_ladder_recipients: {
        Args: {
          p_dropper: string;
          p_house_id: string;
          p_now: string;
          p_rung: string;
        };
        Returns: string[];
      };
      resolve_allied_ladder_rung: {
        Args: { p_from_rung: string; p_house_id: string; p_now: string };
        Returns: {
          recipient_user_id: string;
          rung: string;
        }[];
      };
      resolve_ba_for_house: {
        Args: { p_at: string; p_house_id: string };
        Returns: string;
      };
      resolve_hm_for_house: {
        Args: { p_at: string; p_house_id: string };
        Returns: string;
      };
      resolve_hm_for_user: {
        Args: {
          p_at: string;
          p_interval_start_date?: string;
          p_user_id: string;
        };
        Returns: string;
      };
      resolve_hmod_on_duty: { Args: { p_at: string }; Returns: string };
      resolve_permanent_swap_affected: {
        Args: { p_now?: string; p_swap_id: string };
        Returns: string[];
      };
      resolve_present_desk_workers: {
        Args: { p_house_id: string; p_now: string };
        Returns: string[];
      };
      resolve_rsm_for_house: {
        Args: { p_at: string; p_house_id: string };
        Returns: string;
      };
      resolve_sm_for_house: { Args: { p_house_id: string }; Returns: string[] };
      season_target_headcount: {
        Args: { p_block_start_at: string; p_house_id: string };
        Returns: number;
      };
      send_break_nag: { Args: { p_break_id: string }; Returns: number };
      send_preference_reminders: { Args: never; Returns: number };
      set_allied_resolved: {
        Args: {
          p_notification_id: string;
          p_now: string;
          p_resolved: boolean;
          p_user_id: string;
        };
        Returns: boolean;
      };
      set_house_launch_state: {
        Args: { p_house_id: string; p_live: boolean };
        Returns: undefined;
      };
      set_notification_preferences: {
        Args: {
          p_open_shifts_home_house: boolean;
          p_open_shifts_other_houses: boolean;
          p_shift_reminder_offsets?: number[];
        };
        Returns: {
          open_shifts_home_house: boolean;
          open_shifts_other_houses: boolean;
          shift_reminder_offsets: number[];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'notification_preferences';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_offhours_ladder_enabled: {
        Args: { p_enabled: boolean };
        Returns: undefined;
      };
      set_preference_deadline: {
        Args: {
          p_actor_user_id: string;
          p_period_id: string;
          p_preference_deadline: string;
        };
        Returns: {
          period_id: string;
          preference_deadline: string;
        }[];
      };
      set_staggered_launch_enabled: {
        Args: { p_enabled: boolean };
        Returns: undefined;
      };
      snapshot_float_ack_reminders: {
        Args: {
          p_destination_assignment_ids: string[];
          p_destination_house_id: string;
          p_float_id: string;
          p_now: string;
          p_worker_id: string;
        };
        Returns: number;
      };
      start_offhours_allied_ladder: {
        Args: {
          p_block_id: string;
          p_block_start_at: string;
          p_house_id: string;
          p_now: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      submit_hm_leave: {
        Args: {
          p_end_date: string;
          p_replacement_user_id?: string;
          p_start_date: string;
          p_user_id: string;
        };
        Returns: string;
      };
      submit_preferences: {
        Args: {
          p_opted_out?: boolean;
          p_period_id: string;
          p_preferences: Json;
          p_target_hours: number;
          p_user_id: string;
        };
        Returns: {
          preferences_upserted: number;
          target_upserted: number;
        }[];
      };
      swap_acceptance_ineligibility_reason: {
        Args: { p_swap_id: string };
        Returns: string;
      };
      swap_expiry_is_cron_scheduled: { Args: never; Returns: boolean };
      sweep_suppressed_ack_reminders: {
        Args: { p_now: string };
        Returns: number;
      };
      system_close_obsolete_coverage_requests: {
        Args: { p_now: string };
        Returns: number;
      };
      time_travel_is_allowed: { Args: never; Returns: boolean };
      touch_kb_embedding_cache: {
        Args: { p_content_hashes: string[]; p_model: string; p_now?: string };
        Returns: number;
      };
      transfer_worker: {
        Args: {
          p_dest_house_id: string;
          p_effective_date?: string;
          p_initiator: string;
          p_note?: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      try_orchestrator_tick_lock: { Args: never; Returns: boolean };
      url_encode_mailto_component: {
        Args: { p_value: string };
        Returns: string;
      };
      user_can_build_schedule: {
        Args: { check_house_id: string; check_user_id: string };
        Returns: boolean;
      };
      user_can_select_user: {
        Args: { target_user_id: string; viewer_user_id: string };
        Returns: boolean;
      };
      user_has_house_admin_role: {
        Args: { check_house_id: string; check_user_id: string };
        Returns: boolean;
      };
      user_is_admin: { Args: { check_user_id: string }; Returns: boolean };
      user_is_rsm: { Args: { check_user_id: string }; Returns: boolean };
      user_is_schedule_admin: {
        Args: { check_user_id: string };
        Returns: boolean;
      };
      verify_scheduled_jobs: {
        Args: never;
        Returns: {
          check_name: string;
          detail: string;
          status: string;
        }[];
      };
      wants_open_shift_notification: {
        Args: { p_house_id: string; p_user_id: string };
        Returns: boolean;
      };
      weekly_feed_for_house: {
        Args: {
          p_as_of?: string;
          p_calling_user_id: string;
          p_house_id: string;
        };
        Returns: {
          assignment_id: string;
          block_id: string;
          dropped_at: string | null;
          dropped_by_user_id: string | null;
          is_cross_house_pickup: boolean;
          is_float: boolean;
          parent_float_id: string | null;
          source_house_id: string | null;
          status: Database['public']['Enums']['shift_status_enum'];
          user_id: string | null;
          vacancy_origin: Database['public']['Enums']['vacancy_origin_enum'];
        }[];
        SetofOptions: {
          from: '*';
          to: 'shift_block_assignments';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      weekly_open_shifts_feed: {
        Args: { p_as_of?: string; p_house_id: string };
        Returns: {
          assignment_id: string;
          block_id: string;
          dropped_at: string | null;
          dropped_by_user_id: string | null;
          is_cross_house_pickup: boolean;
          is_float: boolean;
          parent_float_id: string | null;
          source_house_id: string | null;
          status: Database['public']['Enums']['shift_status_enum'];
          user_id: string | null;
          vacancy_origin: Database['public']['Enums']['vacancy_origin_enum'];
        }[];
        SetofOptions: {
          from: '*';
          to: 'shift_block_assignments';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      worker_opted_out_of_break: {
        Args: { p_break_id: string; p_user_id: string };
        Returns: boolean;
      };
      worker_pending_swaps: {
        Args: never;
        Returns: {
          counterparty_assignment_ids: string[];
          counterparty_blocks: number;
          counterparty_end: string;
          counterparty_house_id: string;
          counterparty_house_name: string;
          counterparty_start: string;
          created_at: string;
          direction: string;
          expires_at: string;
          initiator_assignment_ids: string[];
          initiator_blocks: number;
          initiator_end: string;
          initiator_house_id: string;
          initiator_house_name: string;
          initiator_start: string;
          other_user_id: string;
          other_user_name: string;
          recurring_pattern: Json;
          status: string;
          swap_id: string;
          swap_type: string;
        }[];
      };
      worker_shift_reminder_offsets: {
        Args: { p_user_id: string };
        Returns: number[];
      };
      worker_shift_runs: {
        Args: { p_from: string; p_to: string };
        Returns: {
          block_count: number;
          first_assignment_id: string;
          house_id: string;
          house_name: string;
          run_end_at: string;
          run_start_at: string;
          user_id: string;
        }[];
      };
    };
    Enums: {
      allied_coverage_outcome:
        | 'allied_secured'
        | 'covered_internally'
        | 'desk_unstaffed'
        | 'no_longer_needed';
      block_step_status_enum: 'fired' | 'completed_via_force_trigger' | 'rolled_back';
      break_type_enum:
        | 'thanksgiving'
        | 'fall_break'
        | 'spring_break'
        | 'spring_fling'
        | 'winter_break'
        | 'other';
      cap_enforcement_enum: 'soft' | 'hard';
      da_intake_status_enum:
        | 'uploaded'
        | 'normalizing'
        | 'proposed'
        | 'in_review'
        | 'approved'
        | 'embedding'
        | 'live'
        | 'rejected'
        | 'failed'
        | 'deleted';
      da_sensitivity_enum: 'general' | 'internal' | 'restricted';
      da_source_type_enum:
        | 'hm_guide'
        | 'house_binder'
        | 'summer_binder'
        | 'incident_lesson'
        | 'fixture'
        | 'email'
        | 'pdf_upload'
        | 'app_guide';
      da_temporality_enum: 'durable' | 'until_superseded' | 'expires';
      day_type_enum: 'weekday' | 'weekend';
      float_exclusion_reason_enum: 'declined' | 'no_acknowledgment';
      float_initiated_by_enum: 'automated' | 'force_triggered';
      float_status_enum: 'pending' | 'acknowledged' | 'declined' | 'voided' | 'completed';
      hm_leave_status_enum: 'active' | 'cancelled_early';
      notification_type:
        | 'personal_shift'
        | 'broadcast'
        | 'hmod_urgent'
        | 'ack_reminder'
        | 'swap_request'
        | 'hm_leave_notice'
        | 'sm_permanent_drop_alert'
        | 'sw_permanent_removal_alert'
        | 'allied_page'
        | 'shift_reminder';
      preference_status_enum: 'preferred' | 'available' | 'cannot' | 'none';
      scheduling_mode_enum: 'sm_built' | 'claim_based';
      shift_status_enum:
        | 'scheduled'
        | 'claimed'
        | 'floated_in'
        | 'floated_out'
        | 'pending_float_in'
        | 'pending_float_out'
        | 'allied'
        | 'vacant'
        | 'cancelled_config';
      swap_status_enum: 'pending' | 'accepted' | 'rejected' | 'expired' | 'voided';
      swap_type_enum: 'shift_swap' | 'float_swap' | 'permanent_swap' | 'handoff';
      user_role_enum: 'sw' | 'sm' | 'hm' | 'rsm' | 'bm' | 'admin';
      vacancy_origin_enum:
        | 'none'
        | 'temporary_drop'
        | 'permanent_drop'
        | 'never_assigned'
        | 'expired_claim'
        | 'displaced_decliner';
      value_type_enum: 'integer' | 'interval' | 'time_of_day' | 'enum' | 'uuid';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      allied_coverage_outcome: [
        'allied_secured',
        'covered_internally',
        'desk_unstaffed',
        'no_longer_needed',
      ],
      block_step_status_enum: ['fired', 'completed_via_force_trigger', 'rolled_back'],
      break_type_enum: [
        'thanksgiving',
        'fall_break',
        'spring_break',
        'spring_fling',
        'winter_break',
        'other',
      ],
      cap_enforcement_enum: ['soft', 'hard'],
      da_intake_status_enum: [
        'uploaded',
        'normalizing',
        'proposed',
        'in_review',
        'approved',
        'embedding',
        'live',
        'rejected',
        'failed',
        'deleted',
      ],
      da_sensitivity_enum: ['general', 'internal', 'restricted'],
      da_source_type_enum: [
        'hm_guide',
        'house_binder',
        'summer_binder',
        'incident_lesson',
        'fixture',
        'email',
        'pdf_upload',
        'app_guide',
      ],
      da_temporality_enum: ['durable', 'until_superseded', 'expires'],
      day_type_enum: ['weekday', 'weekend'],
      float_exclusion_reason_enum: ['declined', 'no_acknowledgment'],
      float_initiated_by_enum: ['automated', 'force_triggered'],
      float_status_enum: ['pending', 'acknowledged', 'declined', 'voided', 'completed'],
      hm_leave_status_enum: ['active', 'cancelled_early'],
      notification_type: [
        'personal_shift',
        'broadcast',
        'hmod_urgent',
        'ack_reminder',
        'swap_request',
        'hm_leave_notice',
        'sm_permanent_drop_alert',
        'sw_permanent_removal_alert',
        'allied_page',
        'shift_reminder',
      ],
      preference_status_enum: ['preferred', 'available', 'cannot', 'none'],
      scheduling_mode_enum: ['sm_built', 'claim_based'],
      shift_status_enum: [
        'scheduled',
        'claimed',
        'floated_in',
        'floated_out',
        'pending_float_in',
        'pending_float_out',
        'allied',
        'vacant',
        'cancelled_config',
      ],
      swap_status_enum: ['pending', 'accepted', 'rejected', 'expired', 'voided'],
      swap_type_enum: ['shift_swap', 'float_swap', 'permanent_swap', 'handoff'],
      user_role_enum: ['sw', 'sm', 'hm', 'rsm', 'bm', 'admin'],
      vacancy_origin_enum: [
        'none',
        'temporary_drop',
        'permanent_drop',
        'never_assigned',
        'expired_claim',
        'displaced_decliner',
      ],
      value_type_enum: ['integer', 'interval', 'time_of_day', 'enum', 'uuid'],
    },
  },
} as const;
