// AUTO-GENERATED — do not edit by hand.
// Regenerate with: supabase gen types typescript --local > packages/shared/src/database.types.ts
// NOTE: hand-authored for phase-01 because Docker is not yet installed on this machine.
//       Run the command above once Docker + Supabase local are running to replace this file.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
      operating_profiles: {
        Row: {
          profile_name: string;
          shift_start_bound: string;
          shift_end_bound: string;
          default_hours_cap: number;
          default_cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          scheduling_mode: Database['public']['Enums']['scheduling_mode_enum'];
          float_enabled: boolean;
          escalation_chain: Json;
          claim_phase_open_offset: string | null;
          claim_phase_alert_offset: string | null;
          claim_phase_close_offset: string | null;
        };
        Insert: {
          profile_name: string;
          shift_start_bound: string;
          shift_end_bound: string;
          default_hours_cap: number;
          default_cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          scheduling_mode: Database['public']['Enums']['scheduling_mode_enum'];
          float_enabled: boolean;
          escalation_chain: Json;
          claim_phase_open_offset?: string | null;
          claim_phase_alert_offset?: string | null;
          claim_phase_close_offset?: string | null;
        };
        Update: {
          profile_name?: string;
          shift_start_bound?: string;
          shift_end_bound?: string;
          default_hours_cap?: number;
          default_cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          scheduling_mode?: Database['public']['Enums']['scheduling_mode_enum'];
          float_enabled?: boolean;
          escalation_chain?: Json;
          claim_phase_open_offset?: string | null;
          claim_phase_alert_offset?: string | null;
          claim_phase_close_offset?: string | null;
        };
        Relationships: [];
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
      staffing_patterns: {
        Row: {
          profile_name: string;
          house_id: string;
          day_type: Database['public']['Enums']['day_type_enum'];
          block_headcounts: Json;
        };
        Insert: {
          profile_name: string;
          house_id: string;
          day_type: Database['public']['Enums']['day_type_enum'];
          block_headcounts: Json;
        };
        Update: {
          profile_name?: string;
          house_id?: string;
          day_type?: Database['public']['Enums']['day_type_enum'];
          block_headcounts?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'staffing_patterns_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
          {
            foreignKeyName: 'staffing_patterns_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
        ];
      };
      float_routing: {
        Row: {
          profile_name: string;
          source_house_id: string;
          destination_house_id: string;
          precedence_order: number;
        };
        Insert: {
          profile_name: string;
          source_house_id: string;
          destination_house_id: string;
          precedence_order: number;
        };
        Update: {
          profile_name?: string;
          source_house_id?: string;
          destination_house_id?: string;
          precedence_order?: number;
        };
        Relationships: [
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
            foreignKeyName: 'float_routing_destination_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
        ];
      };
      weekly_cap_overrides: {
        Row: {
          week_start_date: string;
          hours_cap: number;
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          modified_by: string | null;
          modified_at: string;
        };
        Insert: {
          week_start_date: string;
          hours_cap: number;
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          modified_by?: string | null;
          modified_at?: string;
        };
        Update: {
          week_start_date?: string;
          hours_cap?: number;
          cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          modified_by?: string | null;
          modified_at?: string;
        };
        Relationships: [];
      };
      hmod_rotor: {
        Row: {
          week_start_date: string;
          hmod_user_id: string;
        };
        Insert: {
          week_start_date: string;
          hmod_user_id: string;
        };
        Update: {
          week_start_date?: string;
          hmod_user_id?: string;
        };
        Relationships: [];
      };
      hm_leave: {
        Row: {
          leave_id: string;
          user_id: string;
          start_date: string;
          end_date: string;
          replacement_user_id: string | null;
          status: Database['public']['Enums']['hm_leave_status_enum'];
          cancelled_at: string | null;
        };
        Insert: {
          leave_id?: string;
          user_id: string;
          start_date: string;
          end_date: string;
          replacement_user_id?: string | null;
          status?: Database['public']['Enums']['hm_leave_status_enum'];
          cancelled_at?: string | null;
        };
        Update: {
          leave_id?: string;
          user_id?: string;
          start_date?: string;
          end_date?: string;
          replacement_user_id?: string | null;
          status?: Database['public']['Enums']['hm_leave_status_enum'];
          cancelled_at?: string | null;
        };
        Relationships: [];
      };
      ack_cadence_config: {
        Row: {
          house_id: string;
          reminder_6h_offset: string | null;
          reminder_2h_offset: string | null;
          modified_by: string | null;
          modified_at: string;
        };
        Insert: {
          house_id: string;
          reminder_6h_offset?: string | null;
          reminder_2h_offset?: string | null;
          modified_by?: string | null;
          modified_at?: string;
        };
        Update: {
          house_id?: string;
          reminder_6h_offset?: string | null;
          reminder_2h_offset?: string | null;
          modified_by?: string | null;
          modified_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ack_cadence_config_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: true;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
        ];
      };
      break_periods: {
        Row: {
          break_id: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          start_date: string;
          end_date: string;
          profile_name: string;
        };
        Insert: {
          break_id?: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          start_date: string;
          end_date: string;
          profile_name: string;
        };
        Update: {
          break_id?: string;
          break_name?: string;
          break_type?: Database['public']['Enums']['break_type_enum'];
          start_date?: string;
          end_date?: string;
          profile_name?: string;
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
      scheduling_periods: {
        Row: {
          period_id: string;
          period_name: string;
          profile_name: string;
          start_date: string;
          end_date: string;
          preference_deadline: string | null;
          published_at: string | null;
        };
        Insert: {
          period_id?: string;
          period_name: string;
          profile_name: string;
          start_date: string;
          end_date: string;
          preference_deadline?: string | null;
          published_at?: string | null;
        };
        Update: {
          period_id?: string;
          period_name?: string;
          profile_name?: string;
          start_date?: string;
          end_date?: string;
          preference_deadline?: string | null;
          published_at?: string | null;
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
      system_config: {
        Row: {
          config_key: string;
          config_value: string;
          value_type: Database['public']['Enums']['value_type_enum'];
          modified_by: string | null;
          modified_at: string;
          notes: string | null;
        };
        Insert: {
          config_key: string;
          config_value: string;
          value_type: Database['public']['Enums']['value_type_enum'];
          modified_by?: string | null;
          modified_at?: string;
          notes?: string | null;
        };
        Update: {
          config_key?: string;
          config_value?: string;
          value_type?: Database['public']['Enums']['value_type_enum'];
          modified_by?: string | null;
          modified_at?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      cap_enforcement_enum: 'soft' | 'hard';
      scheduling_mode_enum: 'sm_built' | 'claim_based';
      day_type_enum: 'weekday' | 'weekend';
      hm_leave_status_enum: 'active' | 'cancelled_early';
      break_type_enum:
        | 'thanksgiving'
        | 'fall_break'
        | 'spring_break'
        | 'spring_fling'
        | 'winter_break'
        | 'other';
      value_type_enum: 'integer' | 'interval' | 'time_of_day' | 'enum';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database['public']['Tables'] & Database['public']['Views'])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions['schema']]['Tables'] &
        Database[PublicTableNameOrOptions['schema']]['Views'])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions['schema']]['Tables'] &
      Database[PublicTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database['public']['Tables'] &
        Database['public']['Views'])
    ? (Database['public']['Tables'] &
        Database['public']['Views'])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends keyof Database['public']['Tables'] | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof Database['public']['Tables']
    ? Database['public']['Tables'][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends keyof Database['public']['Tables'] | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof Database['public']['Tables']
    ? Database['public']['Tables'][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends keyof Database['public']['Enums'] | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions['schema']]['Enums'][EnumName]
  : PublicEnumNameOrOptions extends keyof Database['public']['Enums']
    ? Database['public']['Enums'][PublicEnumNameOrOptions]
    : never;
