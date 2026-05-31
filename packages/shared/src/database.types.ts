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
            foreignKeyName: 'ack_cadence_config_modified_by_fkey';
            columns: ['modified_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
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
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
        ];
      };
      break_periods: {
        Row: {
          break_id: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          end_date: string;
          profile_name: string;
          start_date: string;
        };
        Insert: {
          break_id?: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          end_date: string;
          profile_name: string;
          start_date: string;
        };
        Update: {
          break_id?: string;
          break_name?: string;
          break_type?: Database['public']['Enums']['break_type_enum'];
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
            foreignKeyName: 'float_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
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
            foreignKeyName: 'float_exclusions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
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
            foreignKeyName: 'hm_leave_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
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
        ];
      };
      houses: {
        Row: {
          id: string;
          name: string;
        };
        Insert: {
          id: string;
          name: string;
        };
        Update: {
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          acknowledged_at: string | null;
          created_at: string;
          delivered_at: string | null;
          notification_id: string;
          payload: Json;
          recipient_user_id: string;
          scheduled_for: string | null;
          type: Database['public']['Enums']['notification_type'];
        };
        Insert: {
          acknowledged_at?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          notification_id?: string;
          payload?: Json;
          recipient_user_id: string;
          scheduled_for?: string | null;
          type: Database['public']['Enums']['notification_type'];
        };
        Update: {
          acknowledged_at?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          notification_id?: string;
          payload?: Json;
          recipient_user_id?: string;
          scheduled_for?: string | null;
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
        ];
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
      shift_block_assignments: {
        Row: {
          assignment_id: string;
          block_id: string;
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
            referencedRelation: 'shift_blocks';
            referencedColumns: ['block_id'];
          },
          {
            foreignKeyName: 'shift_block_assignments_parent_float_id_fkey';
            columns: ['parent_float_id'];
            isOneToOne: false;
            referencedRelation: 'float_assignments';
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
            foreignKeyName: 'shift_block_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
          },
        ];
      };
      shift_blocks: {
        Row: {
          block_id: string;
          block_start_at: string;
          house_id: string;
          required_headcount: number;
        };
        Insert: {
          block_id?: string;
          block_start_at: string;
          house_id: string;
          required_headcount: number;
        };
        Update: {
          block_id?: string;
          block_start_at?: string;
          house_id?: string;
          required_headcount?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'shift_blocks_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
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
            foreignKeyName: 'swap_requests_initiator_user_id_fkey';
            columns: ['initiator_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
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
        Relationships: [];
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
            foreignKeyName: 'user_roles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['user_id'];
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
        ];
      };
      weekly_cap_overrides: {
        Row: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
          modified_at: string;
          modified_by: string | null;
          week_start_date: string;
        };
        Insert: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
          modified_at?: string;
          modified_by?: string | null;
          week_start_date: string;
        };
        Update: {
          cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap?: number;
          modified_at?: string;
          modified_by?: string | null;
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
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_swap: {
        Args: { p_accepting_user_id: string; p_now?: string; p_swap_id: string };
        Returns: Json;
      };
      acknowledge_float: {
        Args: { p_float_id: string; p_now?: string; p_user_id: string };
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
      decline_float: {
        Args: { p_float_id: string; p_now?: string; p_user_id: string };
        Returns: Json;
      };
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
      expire_pending_swaps: { Args: { p_now: string }; Returns: number };
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
      hmod_interval_start_date: { Args: { p_at: string }; Returns: string };
      is_assignment_claimable: {
        Args: { p_as_of: string; p_assignment_id: string };
        Returns: boolean;
      };
      is_hm_working_time: { Args: { p_at: string }; Returns: boolean };
      is_valid_block_headcounts: { Args: { p: Json }; Returns: boolean };
      is_valid_escalation_chain: { Args: { p: Json }; Returns: boolean };
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
      send_preference_reminders: { Args: never; Returns: number };
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
      weekly_feed_for_house: {
        Args: {
          p_as_of?: string;
          p_calling_user_id: string;
          p_house_id: string;
        };
        Returns: {
          assignment_id: string;
          block_id: string;
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
    };
    Enums: {
      block_step_status_enum: 'fired' | 'completed_via_force_trigger' | 'rolled_back';
      break_type_enum:
        | 'thanksgiving'
        | 'fall_break'
        | 'spring_break'
        | 'spring_fling'
        | 'winter_break'
        | 'other';
      cap_enforcement_enum: 'soft' | 'hard';
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
        | 'sw_permanent_removal_alert';
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
        | 'vacant';
      swap_status_enum: 'pending' | 'accepted' | 'rejected' | 'expired' | 'voided';
      swap_type_enum: 'shift_swap' | 'float_swap' | 'permanent_swap';
      user_role_enum: 'sw' | 'sm' | 'hm' | 'bm';
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
      ],
      swap_status_enum: ['pending', 'accepted', 'rejected', 'expired', 'voided'],
      swap_type_enum: ['shift_swap', 'float_swap', 'permanent_swap'],
      user_role_enum: ['sw', 'sm', 'hm', 'bm'],
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
