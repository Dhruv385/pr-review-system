import { IsDefined, IsString } from 'class-validator';

export class SecurityConfig {
  @IsDefined()
  @IsString()
  ENCRYPTION_KEY!: string;
}
