import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';

import {
  PLANNER_SETTINGS,
  SETTING_GROUPS,
  DEFAULT_ALGORITHM_SETTINGS,
  DEFAULT_TARGET_SETTINGS,
  type GeneratedPlanDto,
  type PlanDto,
  type PoolItemDto,
  type SettingGroupSpec,
  type SettingSpec,
  type Locale,
  type PageDto,
  type PlanDayDto,
  type RecostRequest,
  type TargetsDto,
  type TemplateDto,
  type AlgorithmSettingsDto,
  type TargetSettingsDto,
} from '@fatoff/contracts';

import type { Response } from 'express';

import { processHttpError } from '../../common/error-patterns';
import { buildPlanPdf } from './plan-pdf';

import {
  GenerateDto,
  PlanQueryDto,
  PoolQueryDto,
  RecostDto,
  RenameTagDto,
  SavePlanDto,
  SaveTemplateDto,
  TargetsQueryDto,
  UpdatePlanDto,
} from './dto/planner.dto';
import { PlannerService } from './planner.service';
import { clampPlannerSettings } from './settings';

/** Описание настроек — интерфейс строит форму по нему, а не по своему представлению. */
interface SettingsSchemaDto {
  groups: SettingGroupSpec[];
  settings: SettingSpec[];
  defaults: { targets: TargetSettingsDto; algorithm: AlgorithmSettingsDto };
}

@Controller('accounts/:id/planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  /**
   * Справочник настроек: заголовки, описания, границы и значения по умолчанию.
   *
   * Отдаётся с сервера, а не зашивается в браузер, чтобы описание настройки и
   * её применение не разъехались: и то и другое читает один и тот же список.
   */
  @Get('settings')
  schema(): SettingsSchemaDto {
    return {
      groups: SETTING_GROUPS,
      settings: PLANNER_SETTINGS,
      defaults: { targets: DEFAULT_TARGET_SETTINGS, algorithm: DEFAULT_ALGORITHM_SETTINGS },
    };
  }

  @Get('targets')
  async targets(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TargetsQueryDto,
  ): Promise<TargetsDto> {
    try {
      return await this.planner.targets(
        id,
        query.rate === undefined ? undefined : { lossRatePctPerWeek: query.rate },
      );
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('pool')
  async pool(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PoolQueryDto,
  ): Promise<PoolItemDto[]> {
    try {
      return await this.planner.pool(id, undefined, { from: query.from, to: query.to });
    } catch (error) {
      processHttpError(error);
    }
  }

  /** Генерация ничего не сохраняет: «ещё вариант» можно жать сколько угодно. */
  @Post('generate')
  async generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateDto,
  ): Promise<GeneratedPlanDto> {
    try {
      const clamped = clampPlannerSettings(body);
      return await this.planner.generate(id, {
        from: body.from,
        to: body.to,
        meals: body.meals,
        training: body.training,
        targets: clamped.targets,
        algorithm: clamped.algorithm,
        pool: body.pool,
        pinned: body.pinned,
        seed: body.seed,
      });
    } catch (error) {
      processHttpError(error);
    }
  }

  /** Пересчёт дня после замены блюда или правки граммовки. Ничего не сохраняет. */
  @Post('recost')
  async recost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecostDto,
  ): Promise<PlanDayDto> {
    try {
      const clamped = clampPlannerSettings(body);
      return await this.planner.recost(id, {
        ...(body as unknown as RecostRequest),
        targets: clamped.targets,
        algorithm: clamped.algorithm,
      });
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('plans')
  async plans(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PlanQueryDto,
  ): Promise<PageDto<PlanDto>> {
    try {
      return await this.planner.listPlans(id, {
        search: query.search,
        tags: query.tags,
        from: query.from,
        to: query.to,
        page: query.page,
        pageSize: query.pageSize,
      });
    } catch (error) {
      processHttpError(error);
    }
  }

  /** Метки аккаунта с числом планов — из них строится фильтр. */
  @Get('plans/tags')
  async planTags(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Array<{ tag: string; count: number }>> {
    try {
      return await this.planner.planTags(id);
    } catch (error) {
      processHttpError(error);
    }
  }

  /**
   * Переименовать метку сразу во всех планах.
   *
   * Путь стоит выше `plans/:planId`: иначе `tags` попало бы в него как
   * идентификатор и отвалилось на разборе UUID.
   */
  @Patch('plans/tags')
  async renameTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameTagDto,
  ): Promise<{ changed: number }> {
    try {
      return await this.planner.renameTag(id, body.from, body.to);
    } catch (error) {
      processHttpError(error);
    }
  }

  /** Убрать метку из всех планов; сами планы остаются. */
  @Delete('plans/tags/:tag')
  async removeTag(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tag') tag: string,
  ): Promise<{ changed: number }> {
    try {
      return await this.planner.removeTag(id, tag);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Post('plans')
  async savePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SavePlanDto,
  ): Promise<PlanDto> {
    try {
      return await this.planner.savePlan(id, {
        name: body.name,
        tags: body.tags,
        plan: body.plan as unknown as GeneratedPlanDto,
      });
    } catch (error) {
      processHttpError(error);
    }
  }

  @Patch('plans/:planId')
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() body: UpdatePlanDto,
  ): Promise<PlanDto> {
    try {
      return await this.planner.updatePlan(id, planId, { name: body.name, tags: body.tags });
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('plans/:planId')
  async plan(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ): Promise<PlanDto> {
    try {
      return await this.planner.plan(id, planId);
    } catch (error) {
      processHttpError(error);
    }
  }

  /** План одним файлом PDF на выбранном языке. */
  @Get('plans/:planId/pdf')
  async planPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Query('lang') lang: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const locale: Locale = lang === 'en' ? 'en' : 'ru';
      const plan = await this.planner.plan(id, planId);
      const file = await buildPlanPdf({ plan, locale, generatedAt: new Date() });

      // имя файла из названия плана: пробелы и знаки в заголовке ломают
      // загрузку в части браузеров, поэтому оставляем буквы, цифры и дефис
      const slug = plan.name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '');
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="fatoff-plan.pdf"; filename*=UTF-8''${encodeURIComponent(`fatoff-${slug || 'plan'}.pdf`)}`,
      );
      response.end(file);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Delete('plans/:planId')
  async removePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ): Promise<{ ok: true }> {
    try {
      await this.planner.removePlan(id, planId);
      return { ok: true };
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get('templates')
  async templates(@Param('id', ParseUUIDPipe) id: string): Promise<TemplateDto[]> {
    try {
      return await this.planner.templates(id);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Post('templates')
  async saveTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveTemplateDto,
  ): Promise<TemplateDto> {
    try {
      return await this.planner.saveTemplate(id, {
        name: body.name,
        description: body.description,
        settings: body.settings,
      });
    } catch (error) {
      processHttpError(error);
    }
  }

  @Delete('templates/:templateId')
  async removeTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('templateId') templateId: string,
  ): Promise<{ ok: true }> {
    try {
      await this.planner.removeTemplate(id, templateId);
      return { ok: true };
    } catch (error) {
      processHttpError(error);
    }
  }
}
